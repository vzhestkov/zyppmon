qx.Class.define("zyppmon.AnalizeWindow", {
	extend : qx.ui.window.Window,
	include : [qx.locale.MTranslation],
	construct : function() {
		this.base(arguments, this.tr("WINDOW_HDR_ANALIZE"));
		
		this.setShowMinimize(false);
		this.setResizable(true);
		this.setModal(true);
		this.setWidth(860);
		this.setHeight(470);

		var layout = new qx.ui.layout.VBox;
		this.setLayout(layout);
		this.setContentPadding(0);
		
		var toolbar = new qx.ui.toolbar.ToolBar();
		toolbar.setOverflowHandling(true);
		this.systemsSelectBox = new qx.ui.form.SelectBox().set({
			minWidth: 240,
			maxWidth: 420,
			allowGrowX: true,
			allowGrowY: false,
			alignY: "middle"
		});
		this.systemsSelectBox.addListener("changeSelection", this._changeSelection, this);
		toolbar.addSeparator();
		toolbar.add(this.systemsSelectBox);
		this.templatesSelectBox = new qx.ui.form.SelectBox().set({
			minWidth: 240,
			maxWidth: 420,
			allowGrowX: true,
			allowGrowY: false,
			alignY: "middle"
		});
		this.templatesSelectBox.addListener("changeSelection", this._changeSelection, this);
		toolbar.addSeparator();
		toolbar.add(this.templatesSelectBox);
		this.analizeButton = new qx.ui.toolbar.Button(this.tr("ANALIZE_TOOLBAR_BTN_ANALIZE"), "icon/analize22.png");
		this.analizeButton.setEnabled(false);
		this.analizeButton.addListener("execute", this._startAnalize, this);
		toolbar.add(this.analizeButton);
		toolbar.addSpacer();
		this.compareButton = new qx.ui.toolbar.Button(null, "icon/compare22.png");
		this.compareButton.setEnabled(false);
		this.compareButton.addListener("execute", this.compareSystems, this);
		this.compareButton.set({toolTip: new qx.ui.tooltip.ToolTip(this.tr("PACKAGES_TOOLBAR_BTN_COMPARE_HINT"))});
		toolbar.add(this.compareButton);
		this.add(toolbar);

		var rpn = new qx.ui.table.cellrenderer.String("right");
		var ccr = new qx.ui.table.cellrenderer.String("center");
		var analizeTblColumns = [
				{ id: "usid", label: this.tr("ANALIZE_TBL_HDR_USID"), sortable: false,
					mandatory: false, visible: false },
				{ id: "systemName", label: this.tr("ANALIZE_TBL_HDR_NAME"), sortable: false,
					mandatory: true, visible: true, resizeBehaviour: { minWidth:240, maxWidth:360 } },
				{ id: "osName", label: this.tr("ANALIZE_TBL_HDR_OS"), sortable: false,
					mandatory: true, visible: true, resizeBehaviour: { minWidth:240, maxWidth:360 } },
				{ id: "osVersion", label: this.tr("ANALIZE_TBL_HDR_VER"), sortable: false,
					mandatory: true, visible: true, resizeBehaviour: { minWidth:60, maxWidth:100 } },
				{ id: "osArch", label: this.tr("ANALIZE_TBL_HDR_ARCH"), sortable: false,
					mandatory: true, visible: true, resizeBehaviour: { minWidth:60, maxWidth:80 } },
				{ id: "match", label: this.tr("ANALIZE_TBL_HDR_MATCH"), sortable: true,
					mandatory: true, visible: false },
				{ id: "matchVR", label: this.tr("ANALIZE_TBL_HDR_MATCH_VR"), sortable: true,
					mandatory: true, visible: false },
				{ id: "matchP", label: this.tr("ANALIZE_TBL_HDR_MATCH"), sortable: false,
					mandatory: true, visible: true, resizeBehaviour: { minWidth:100, maxWidth:120 }, cellRenderer: rpn },
				{ id: "matchPVR", label: this.tr("ANALIZE_TBL_HDR_MATCH_VR"), sortable: false,
					mandatory: true, visible: true, resizeBehaviour: { minWidth:100, maxWidth:120 }, cellRenderer: rpn }

			];
		this._analizeTable = new zyppmon.table.ZyppmonTable(analizeTblColumns);
		this._analizeTable.setFocusCellOnPointerMove(true);
		this._analizeTable.addListener("cellTap", function (e) {
				this.setFocusCellOnPointerMove(!this.getFocusCellOnPointerMove());
			});
		this._analizeTable.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
		this._analizeTable.getSelectionModel().addListener("changeSelection", function(e) {
					var sm = this._analizeTable.getSelectionModel();
					this.compareButton.setEnabled(sm.getSelectedCount() == 1);
				}, this);
		this._analizeTable.addListener("cellDbltap", this.compareSystems, this);
		this.add(this._analizeTable, {flex: 1});

		this.moveTo(Math.round((qx.bom.Viewport.getWidth()-this.getWidth())/2), 80);

		this.addListener("close", function (e) {
			this.destroy();
		}, this);
	},

	members: {
		_startAnalize: function(e) {
			var sel1 = this.systemsSelectBox.getSelection()[0];
			var sel2 = this.templatesSelectBox.getSelection()[0];
			if ( !(sel1 && sel2) ) return;
			var system = sel1.getModel();
			var template = sel2.getModel();
			if ( !(system && template) ) return;
			this.analizeButton.setEnabled(false);
			this.setCaption(this.tr("WINDOW_HDR_ANALIZE_%1", system.getName()));
			this._analizeTable.clearTable();
			this._analizeSystem = system;
			this._analizeTemplate = template;
			template.addListener("analizeDataLoaded", this._showAnalizeData, this);
			template.analize(system);
		},
		_showAnalizeData: function(e) {
			this._analizeTemplate.removeListener("analizeDataLoaded", this._showAnalizeData, this);
			var dt = e.getData();
			if ( !dt.data ) return;
			dt.data.forEach(function(el) {
					el.matchP = (new Number(el.match * 100).toFixed(2)) + '%';
					el.matchPVR = (new Number(el.matchVR * 100).toFixed(2)) + '%';
				});
			var tm = this._analizeTable.getTableModel();
			tm.setDataAsMapArray(dt.data);
			tm.sortByColumn(5, false);
		},
		_changeSelection: function(e) {
			this.analizeButton.setEnabled(false);
			var sel1 = this.systemsSelectBox.getSelection()[0];
			var sel2 = this.templatesSelectBox.getSelection()[0];
			if ( !(sel1 && sel2) ) return;
			var sh = sel1.getSizeHint(true);
			this.systemsSelectBox.setWidth(sh.width+20);
			sh = sel2.getSizeHint(true);
			this.templatesSelectBox.setWidth(sh.width+20);
			var s1 = sel1.getModel();
			var s2 = sel2.getModel();
			if ( !(s1 && s2) ) return;
			this.analizeButton.setEnabled(true);
		},
		showAnalizeWindow: function(systemsList) {
			this._systemsList = systemsList;
			this.systemsController = new qx.data.controller.List(systemsList.filter(function(itm) {
						return itm.getEnabled() && itm.getType() != 'template';
					}, this), this.systemsSelectBox, "label");
			this.templatesController = new qx.data.controller.List(systemsList.filter(function(itm) {
						return itm.getEnabled() && !itm.getParentSystem() && itm.getType() == 'template';
					}, this), this.templatesSelectBox, "label");
			var sel = systemsList.getActive();
			if ( sel )
				this.systemsSelectBox.setModelSelection([sel]);
			this.open();
		},
		compareSystems: function(e) {
			var sel1 = this.systemsSelectBox.getSelection()[0];
			if ( !sel1 ) return;
			var system = sel1.getModel();
			if ( !system ) return;
			var tm = this._analizeTable.getTableModel();
			var sm = this._analizeTable.getSelectionModel();
			var usid2;
			sm.iterateSelection(function(itm) {
				var rd = tm.getRowDataAsMap(itm);
				usid2 = rd.usid;
			});
			if ( !usid2 ) return;
			var system2 = this._systemsList.getByUSID(usid2);
			if ( !system2 ) return;
			var compareWindow = new zyppmon.CompareWindow();
			compareWindow.showCompareWindow(this._systemsList, system, system2);
		}
	}
});
