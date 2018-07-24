qx.Class.define("zyppmon.CompareWindow", {
	extend : qx.ui.window.Window,
	include : [qx.locale.MTranslation],
	construct : function() {
		this.base(arguments, this.tr("WINDOW_HDR_COMPARE"));
		
		this.setShowMinimize(false);
		this.setResizable(true);
		this.setModal(true);
		this.setWidth(1000);
		this.setHeight(470);

		var layout = new qx.ui.layout.VBox;
		this.setLayout(layout);
		this.setContentPadding(0);
		
		var toolbar = new qx.ui.toolbar.ToolBar();
		toolbar.setOverflowHandling(true);
		this.systemsSelectBox1 = new qx.ui.form.SelectBox().set({
			minWidth: 240,
			maxWidth: 420,
			allowGrowX: true,
			allowGrowY: false,
			alignY: "middle"
		});
		this.systemsSelectBox1.addListener("changeSelection", this._changeSelection, this);
		toolbar.addSeparator();
		toolbar.add(this.systemsSelectBox1);
		this.systemsSelectBox2 = new qx.ui.form.SelectBox().set({
			minWidth: 240,
			maxWidth: 420,
			allowGrowX: true,
			allowGrowY: false,
			alignY: "middle"
		});
		this.systemsSelectBox2.addListener("changeSelection", this._changeSelection, this);
		toolbar.addSeparator();
		toolbar.add(this.systemsSelectBox2);
		this.compareButton = new qx.ui.toolbar.Button(this.tr("COMPARE_TOOLBAR_BTN_COMPARE"), "icon/compare22.png");
		this.compareButton.setEnabled(false);
		this.compareButton.addListener("execute", this._startCompare, this);
		toolbar.add(this.compareButton);
		toolbar.addSpacer();
		var textField = new qx.ui.form.TextField().set({
			allowGrowY: false,
			alignY: "middle"
		});
		this.searchPackage = textField;
		textField.setEnabled(false);
		textField.setWidth(200);
		textField.setNativeContextMenu(true);
		textField.addListener("keypress", function(e) {
			if (e.getKeyIdentifier().toLowerCase() == "enter") {
				this.setFilter();
			}
		}, this);
		toolbar.add(textField);
		toolbar.addSeparator();
		this.diffOnly = new qx.ui.toolbar.CheckBox(this.tr("COMPARE_CHKBOX_DIFFONLY"));
		this.diffOnly.setEnabled(false);
		this.diffOnly.addListener("changeValue", this._setShowDiff, this);
		toolbar.add(this.diffOnly);
		this.installedOnly = new qx.ui.toolbar.CheckBox(this.tr("COMPARE_CHKBOX_INSTALLED"));
		this.installedOnly.setEnabled(false);
		this.installedOnly.addListener("changeValue", this._setShowDiff, this);
		toolbar.add(this.installedOnly);
		this.add(toolbar);

		var rpn = new qx.ui.table.cellrenderer.String("right");
		var ccr = new qx.ui.table.cellrenderer.String("center");
		var cscr = new qx.ui.table.cellrenderer.Conditional();
		cscr.addRegex('^[0-9]+$', "right");
		cscr.addRegex('%$', "right");
		var cmpInfoTblColumns = [
				{ id: "label", label: this.tr("COMPARE_TBL_INFO_HDR_PROP"), sortable: false,
					mandatory: true, visible: true, resizeBehaviour: { minWidth:140, maxWidth:180 }, cellRenderer: rpn },
				{ id: "s0", label: this.tr("COMPARE_TBL_INFO_HDR_SYS1"), sortable: false,
					mandatory: true, visible: true, resizeBehaviour: { minWidth:240, maxWidth:360 }, cellRenderer: cscr },
				{ id: "s1", label: this.tr("COMPARE_TBL_INFO_HDR_SYS2"), sortable: false,
					mandatory: true, visible: true, resizeBehaviour: { minWidth:240, maxWidth:360 }, cellRenderer: cscr },
				{ id: "eq", label: this.tr("COMPARE_TBL_INFO_HDR_EQ"), sortable: false, visible: false },
			];
		this._infoTable = new zyppmon.table.ZyppmonTable(cmpInfoTblColumns);
		this._infoTable.setFocusCellOnPointerMove(true);
		this._infoTable.addListener("cellTap", function (e) {
				this.setFocusCellOnPointerMove(!this.getFocusCellOnPointerMove());
			});
		this._infoTable.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
		this._infoTable.setStatusBarVisible(false);
		var cmpPkgsTblColumns = [
				{ id: "name", label: this.tr("COMPARE_TBL_PKGS_HDR_NAME"),
					mandatory: true, visible: true, resizeBehaviour: { minWidth:320, maxWidth:400} },
				{ id: "arch", label: this.tr("COMPARE_TBL_PKGS_HDR_ARCH"),
					mandatory: true, visible: true, resizeBehaviour: { minWidth:100, maxWidth:120 } },
				{ id: "vr0", label: this.tr("COMPARE_TBL_PKGS_HDR_VR1"),
					mandatory: true, visible: true, resizeBehaviour: { minWidth:200, maxWidth:240 } },
				{ id: "vrc", label: this.tr("COMPARE_TBL_PKGS_HDR_VRC"),
					mandatory: true, visible: true, resizeBehaviour: { minWidth:50, maxWidth:70 }, cellRenderer: ccr },
				{ id: "vr1", label: this.tr("COMPARE_TBL_PKGS_HDR_VR2"),
					mandatory: true, visible: true, resizeBehaviour: { minWidth:200, maxWidth:240 } }
			];
		this._pkgsTable = new zyppmon.table.ZyppmonTable(cmpPkgsTblColumns);
		this._pkgsTable.setFocusCellOnPointerMove(true);
		this._pkgsTable.addListener("cellTap", function (e) {
				this.setFocusCellOnPointerMove(!this.getFocusCellOnPointerMove());
			});
		this._pkgsTable.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
		var frame = new qx.ui.container.Composite(new qx.ui.layout.Grow());
		this.add(frame, {flex: 1});
		var splitpane = new qx.ui.splitpane.Pane("vertical");
		splitpane.add(this._infoTable, 1);
		splitpane.add(this._pkgsTable, 2);
		frame.add(splitpane);

		this.moveTo(Math.round((qx.bom.Viewport.getWidth()-this.getWidth())/2), 80);

		this.addListener("close", function (e) {
			this.destroy();
		}, this);
	},

	members: {
		_startCompare: function (e) {
			this.diffOnly.setEnabled(false);
			this.diffOnly.setValue(false);
			this.installedOnly.setEnabled(false);
			this.installedOnly.setValue(false);
			this.searchPackage.setEnabled(false);
			this.searchPackage.setValue("");
			var sel1 = this.systemsSelectBox1.getSelection()[0];
			var sel2 = this.systemsSelectBox2.getSelection()[0];
			if ( !(sel1 && sel2) ) return;
			var s1 = sel1.getModel();
			var s2 = sel2.getModel();
			if ( !(s1 && s2) ) return;
			this.compareButton.setEnabled(false);
			this.setCaption(this.tr("WINDOW_HDR_COMPARE_%1_%2", s1.getName(), s2.getName()));
			this._infoTable.clearTable();
			this._pkgsTable.clearTable();
			this._cmpSystem = s1;
			s1.addListener("compareDataLoaded", this._showCmpData, this);
			s1.compare(s2);
		},
		_showCmpData: function(e) {
			if ( this._cmpSystem ) {
				this._cmpSystem.removeListener("compareDataLoaded", this._showCmpData, this);
				this._cmpSystem = null;
			}
			var dt = e.getData();
			if ( !(dt.info_cmp && dt.stat_cmp) ) return;
			var stat_cmp = {};
			dt.stat_cmp.forEach(function (el) {
					stat_cmp[el.p] = {s0: el.s0 != null ? el.s0.toString() : "",
									  s1: el.s1 != null ? el.s1.toString() : ""};
				}, this);
			var std = [];
			var _stat_ps = zyppmon.DashWindow.getLabels();
			_stat_ps.forEach(function (el) {
					if ( stat_cmp[el.name] ) std.push({label: el.label,
													   s0: stat_cmp[el.name].s0, s1: stat_cmp[el.name].s1,
													   eq: stat_cmp[el.name].s0 == stat_cmp[el.name].s1 ? 1 : 0});
				}, this);
			var info_cmp = {};
			dt.info_cmp.forEach(function (el) {
					info_cmp[el.p] = {s0: el.s0 != null ? el.s0.toString() : "",
									  s1: el.s1 != null ? el.s1.toString() : ""};
				}, this);
			var ind = [];
			var _info_ps = zyppmon.InfoWindow.getLabels();
			_info_ps.forEach(function (el) {
					if ( info_cmp[el.name] ) ind.push({label: el.label+':',
													   s0: info_cmp[el.name].s0, s1: info_cmp[el.name].s1,
													   eq: (info_cmp[el.name].s0 == info_cmp[el.name].s1) ? 1 : 0});
				}, this);
			ind.push({});
			ind = ind.concat(std);
			ind.push({});
			var stt = {
					eqpkt: 0,
					eq: 0,
					eqtp: 0,
					s0c: 0,
					s1c: 0,
					eq0p: 0,
					eq1p: 0,
					s0n: 0,
					s1n: 0,
					s0nw: 0,
					s1nw: 0,
					s0np: 0,
					s1np: 0
				};
			dt.packages_cmp.forEach(function (el) {
					if ( el.vrc === 0 ) {
						el.vrc = '=';
						stt.eqpkt++;
						stt.eq++;
						stt.s0c++;
						stt.s1c++;
					} else if ( el.vrc === 1 ) {
						el.vrc = '<';
						if ( el.vr0 === '-' ) {
							stt.s0np++;
							stt.s1c++;
						} else {
							stt.eqpkt++;
							stt.s1n++;
							stt.s0c++;
							stt.s1c++;
						}
					} else if ( el.vrc === -1 ) {
						el.vrc = '>';
						if ( el.vr1 === '-' ) {
							stt.s1np++;
							stt.s0c++;
						} else {
							stt.eqpkt++;
							stt.s0n++;
							stt.s0c++;
							stt.s1c++;
						}
					}
				}, this);
			stt.eq0pk = ( stt.eqpkt / stt.s0c ) * 100;
			stt.eq1pk = ( stt.eqpkt / stt.s1c ) * 100;
			stt.eq0p = ( stt.eq / stt.s0c ) * 100;
			stt.eq1p = ( stt.eq / stt.s1c ) * 100;
			stt.eqtp = ( stt.eq / stt.eqpkt ) * 100;
			stt.s0nw = ( stt.s0n / stt.eqpkt ) * 100;
			stt.s1nw = ( stt.s1n / stt.eqpkt ) * 100;
			ind = ind.concat([
					{label: this.tr("COMPARE_TBL_LBL_PSTAT_COUNT"), s0: stt.s0c.toString(), s1: stt.s1c.toString()},
					{label: this.tr("COMPARE_TBL_LBL_PSTAT_EQPKT"), s0: stt.eqpkt.toString(), s1: stt.eqpkt.toString()},
					{label: this.tr("COMPARE_TBL_LBL_PSTAT_EQPPRC"), s0: stt.eq0pk.toFixed(2)+'%', s1: stt.eq1pk.toFixed(2)+'%'},
					{label: this.tr("COMPARE_TBL_LBL_PSTAT_EQ"), s0: stt.eq.toString(), s1: stt.eq.toString()},
					{label: this.tr("COMPARE_TBL_LBL_PSTAT_EQPRC"), s0: stt.eq0p.toFixed(2)+'% / '+stt.eqtp.toFixed(2)+'%',
					 		s1: stt.eq1p.toFixed(2)+'% / '+stt.eqtp.toFixed(2)+'%'},
					{label: this.tr("COMPARE_TBL_LBL_PSTAT_NEWER"), s0: stt.s0n.toString(), s1: stt.s1n.toString()},
					{label: this.tr("COMPARE_TBL_LBL_PSTAT_NWPRC"), s0: stt.s0nw.toFixed(2)+'%', s1: stt.s1nw.toFixed(2)+'%'},
					{label: this.tr("COMPARE_TBL_LBL_PSTAT_NOTPRESENT"), s0: stt.s0np.toString(), s1: stt.s1np.toString()}
				]);
			this._infoTable.getTableModel().setDataAsMapArray(ind);
			var ptm = this._pkgsTable.getTableModel();
			ptm.setDataAsMapArray(dt.packages_cmp);
			ptm.sortByColumn(0, true);
			this.diffOnly.setEnabled(true);
			this.installedOnly.setEnabled(true);
			this.searchPackage.setEnabled(true);
		},
		_setShowDiff: function(e) {
			if ( this.diffOnly.getEnabled() == false ) return;
			this.setFilter();
		},
		setFilter: function(e) {
			var searchPkg = this.searchPackage.getValue();
			var diffOnly = this.diffOnly.getValue();
			var installedOnly = this.installedOnly.getValue();
			var itm = this._infoTable.getTableModel();
			var ptm = this._pkgsTable.getTableModel();
			itm.resetHiddenRows();
			ptm.resetHiddenRows();
			if ( diffOnly || installedOnly || searchPkg > "" ) {
				if ( diffOnly ) {
					itm.addNumericFilter("==", 1, "eq");
					itm.applyFilters();
					ptm.addRegex("^=$", "vrc", false);
				}
				if ( installedOnly ) {
					ptm.addRegex("^-$", "vr0", false);
					ptm.addRegex("^-$", "vr1", false);
				}
				if ( searchPkg > "" ) {
					if ( searchPkg.match(/^\".*\"$/) ) {
						ptm.addNotRegex("^"+searchPkg.replace(/^\"(.*)\"$/,'$1')+"$", "name", true);
					} else {
						ptm.addNotRegex(searchPkg, "name", true);
					}
				}
				ptm.applyFilters();
			}
		},
		_changeSelection: function(e) {
			var sel1 = this.systemsSelectBox1.getSelection()[0];
			var sel2 = this.systemsSelectBox2.getSelection()[0];
			if ( !(sel1 && sel2) ) return;
			var sh = sel1.getSizeHint(true);
			this.systemsSelectBox1.setWidth(sh.width+20);
			sh = sel2.getSizeHint(true);
			this.systemsSelectBox2.setWidth(sh.width+20);
			var s1 = sel1.getModel();
			var s2 = sel2.getModel();
			if ( !(s1 && s2) ) return;
			this.compareButton.setEnabled(s1.getUSID() != s2.getUSID());
		},
		showCompareWindow: function (systemsList, system1, system2) {
			this._systemsList = systemsList;
			this.systemsController1 = new qx.data.controller.List(systemsList.filter(function(itm) {
						return itm.getEnabled() && itm.getType() != 'template';
					}, this), this.systemsSelectBox1, "label");
			var sel = system1 ? system1 : systemsList.getActive();
			if ( sel )
				this.systemsSelectBox1.setModelSelection([sel]);
			this.systemsController2 = new qx.data.controller.List(systemsList.filter(function(itm) {
						return itm.getEnabled() && itm.getType() != 'template';
					}, this), this.systemsSelectBox2, "label");
			if ( system2 ) {
				this.systemsSelectBox2.setModelSelection([system2]);
				if ( sel.getUSID() != system2.getUSID() )
					this._startCompare();
			}
			this.open();
		}
	}
});
