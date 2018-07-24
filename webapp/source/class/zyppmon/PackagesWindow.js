qx.Class.define("zyppmon.PackagesWindow", {
	extend: qx.ui.window.Window,
	include: [qx.locale.MTranslation],

	construct: function() {
		this.base(arguments, this.tr("WINDOW_HDR_PACKAGES"));
		this.setShowClose(false);
		this.setShowMinimize(false);
		this.setShowMaximize(false);
		this.setAllowMaximize(false);
		this.maximize();

		// add the layout
		var layout = new qx.ui.layout.VBox;
		this.setLayout(layout);
		// toolbar
		var toolbar = new qx.ui.toolbar.ToolBar();
		toolbar.setOverflowHandling(true);
		this.add(toolbar);
		this.setContentPadding(0);
		var archSelectBox = new qx.ui.form.SelectBox().set({
			allowGrowY: false,
			alignY: "middle"
		});
		this._archSelector = archSelectBox;
		var selections = {"all": this.tr("PACKAGES_TOOLBAR_SLCT_ARCH_ALL"), "x86_64": "x86_64",
			"i386": "i386", "i586": "i586", "i686": "i686", "aarch64": "aarch64", "noarch": "noarch"};
		for (var key in selections) {
			var item = new qx.ui.form.ListItem(selections[key]);
			item.setUserData("value", key);
			archSelectBox.add(item);
		}
		archSelectBox.addListener("changeSelection", function(e) {
			this.setFilter();
		}, this);
		var archFilterPart = new qx.ui.toolbar.Part();
		archFilterPart.add(archSelectBox);
		toolbar.add(archFilterPart);
		var remSelectBox = new qx.ui.form.SelectBox().set({
			allowGrowY: false,
			alignY: "middle"
		});
		this._remSelector = remSelectBox;
		var remSelections = [this.tr("PACKAGES_TOOLBAR_RSLCT_INSTALLED"),
					this.tr("PACKAGES_TOOLBAR_RSLCT_REMOVED"), this.tr("PACKAGES_TOOLBAR_RSLCT_ALL")];
		for (var key in remSelections) {
			var item = new qx.ui.form.ListItem(remSelections[key]);
			item.setUserData("value", key);
			remSelectBox.add(item);
		}
		remSelectBox.addListener("changeSelection", function(e) {
			this.setFilter();
		}, this);
		var filterPart = new qx.ui.toolbar.Part();
		filterPart.add(remSelectBox);
		var textField = new qx.ui.form.TextField().set({
			allowGrowY: false,
			alignY: "middle"
		});
		this._searchPackage = textField;
		textField.setWidth(200);
		textField.setNativeContextMenu(true);
		textField.addListener("keypress", function(e) {
			if (e.getKeyIdentifier().toLowerCase() == "enter") {
				this.setFilter();
			}
		}, this);
		filterPart.addSeparator();
		filterPart.add(textField);
		toolbar.add(filterPart);
		var clearFilterButton = new qx.ui.toolbar.Button(this.tr("PACKAGES_TOOLBAR_BTN_CLEARFILTER"));
		clearFilterButton.addListener("execute", function (e) {
			this._searchPackage.setValue("");
			this._archSelector.resetSelection();
			this._remSelector.resetSelection();
			this.setTableFilter();
		}, this);
		toolbar.add(clearFilterButton);
		toolbar.addSpacer();

		this.systemsSelectBox = new qx.ui.form.SelectBox().set({
			minWidth: 240,
			maxWidth: 420,
			allowGrowX: true,
			allowGrowY: false,
			alignY: "middle"
		});
		this.systemsSelectBox.addListener("changeSelection", function (e) {
			var sel = this.systemsSelectBox.getSelection()[0];
			if ( !sel ) return;
			var m = sel.getModel();
			if ( m ) this.appInstance.systemsList.setActive(m);
			var sh = sel.getSizeHint(true);
			this.systemsSelectBox.setWidth(sh.width+20);
		}, this);
		toolbar.addSeparator();
		toolbar.add(this.systemsSelectBox);

		var infoButton = new qx.ui.toolbar.Button(null, "icon/info22.png");
		infoButton.addListener("execute", this.showInfo, this);
		infoButton.set({toolTip: new qx.ui.tooltip.ToolTip(this.tr("PACKAGES_TOOLBAR_BTN_INFO_HINT"))});
		toolbar.add(infoButton);
		var analizeButton = new qx.ui.toolbar.Button(null, "icon/analize22.png");
		analizeButton.addListener("execute", this.analizeSystem, this);
		analizeButton.set({toolTip: new qx.ui.tooltip.ToolTip(this.tr("PACKAGES_TOOLBAR_BTN_ANALIZE_HINT"))});
		toolbar.add(analizeButton);
		var compareButton = new qx.ui.toolbar.Button(null, "icon/compare22.png");
		compareButton.addListener("execute", this.compareSystems, this);
		compareButton.set({toolTip: new qx.ui.tooltip.ToolTip(this.tr("PACKAGES_TOOLBAR_BTN_COMPARE_HINT"))});
		toolbar.add(compareButton);
		var reloadButton = new qx.ui.toolbar.Button(this.tr("PACKAGES_TOOLBAR_BTN_RELOAD"), "icon/reload22.png");
		reloadButton.addListener("execute", this.loadData, this);
		toolbar.add(reloadButton);

		toolbar.setRemovePriority(archFilterPart, 2, false);
		toolbar.setRemovePriority(filterPart, 1, false);
		toolbar.setRemovePriority(clearFilterButton, 3, false);

		var ncr = new qx.ui.table.cellrenderer.Number();
		var dcr = new qx.ui.table.cellrenderer.Date();
		dcr.setDateFormat(new qx.util.format.DateFormat('yyyy-MM-dd HH:mm:ss'));
		var tmPkgsColumns = [
				{ id: "name", label: this.tr("PACKAGES_TBL_HDR_NAME"),
					mandatory: true, visible: true, resizeBehaviour: { minWidth:240, maxWidth:360} },
				{ id: "ver_rel", label: this.tr("PACKAGES_TBL_HDR_VER_REL"),
					visible: true, resizeBehaviour: { minWidth:170, maxWidth:190 } },
				{ id: "ver", label: this.tr("PACKAGES_TBL_HDR_VERSION"),
					visible: false, resizeBehaviour: { minWidth:120, maxWidth:150 } },
				{ id: "rel", label: this.tr("PACKAGES_TBL_HDR_RELEASE"),
					visible: false, resizeBehaviour: { minWidth:120, maxWidth:150 } },
				{ id: "arch", label: this.tr("PACKAGES_TBL_HDR_ARCH"),
					visible: true, resizeBehaviour: { minWidth:80, maxWidth:100 } },
				{ id: "installTime", label: this.tr("PACKAGES_TBL_HDR_INSTALL_TM"),
					visible: true, resizeBehaviour: { minWidth:160, maxWidth:200 }, cellRenderer: dcr },
				{ id: "vendor", label: this.tr("PACKAGES_TBL_HDR_VENDOR"),
					visible: true, resizeBehaviour: { minWidth:200, maxWidth:230 } },
				{ id: "repoName", label: this.tr("PACKAGES_TBL_HDR_REPO_NAME"),
					visible: true, resizeBehaviour: { minWidth:200, maxWidth:230 } },
				{ id: "repoAlias", label: this.tr("PACKAGES_TBL_HDR_REPO_ALIAS"),
					visible: false, resizeBehaviour: { minWidth:200, maxWidth:230 } },
				{ id: "distr", label: this.tr("PACKAGES_TBL_HDR_DISTR"),
					visible: true, resizeBehaviour: { minWidth:200, maxWidth:230 } },
				{ id: "mods", label: this.tr("PACKAGES_TBL_HDR_MODIFIES"),
					visible: true, resizeBehaviour: { minWidth:60, maxWidth:80 }, cellRenderer: ncr },
				{ id: "removed", label: this.tr("PACKAGES_TBL_HDR_REMOVED"), visible: false },
				{ id: "fInstTime", label: this.tr("PACKAGES_TBL_HDR_FINSTTME"), visible: false, cellRenderer: dcr }
			];
		var table = new zyppmon.table.ZyppmonTable(tmPkgsColumns);
		table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
		table.addListener("cellDbltap", this.doubleClick, this);
		table.setFocusCellOnPointerMove(true);
		table.addListener("cellTap", function (e) {
				this.setFocusCellOnPointerMove(!this.getFocusCellOnPointerMove());
			});

		this._table = table;
		this.add(this._table, { flex: 1 });
	},

	members: {
		url: "/packages",
		filter_arch: null,
		filter_rem: null,
		filter_name: null,
		appInstance: null,
		__system: null,
		setAppInstance: function(app) {
			this.appInstance = app;
			this.systemsController = new qx.data.controller.List(app.systemsList, this.systemsSelectBox, "label");
			app.systemsList.addListener("systemsUpdated", this.__updateSystemsList, this);
			app.systemsList.addListener("statesUpdated", this.__updateSystemsList, this);
		},
		__updateSystemsList: function(e) {
			this.systemsController.setModel(this.appInstance.systemsList.filter(function(itm) {
				return itm.getEnabled() && itm.getType() != 'template';
			}, this));
		},
		setFilter: function() {
			this.setTableFilter(this._archSelector.getSelection()[0].getUserData("value"),
				this._remSelector.getSelection()[0].getUserData("value"),
				this._searchPackage.getValue());
		},
		doubleClick: function(e) {
			if ( this.historyWindow ) {
				var rowIndex = e.getRow();
				var rd = this._table.getTableModel().getRowDataAsMap(rowIndex);
				this.historyWindow.setPackageToShow(rd.name, rd.arch);
			}
		},
		setHistoryWindow: function(historyWindow) {
			this.historyWindow = historyWindow;
		},
		showInfo: function(e) {
			var sel = this.systemsSelectBox.getSelection()[0];
			if ( !sel ) return;
			var s = sel.getModel();
			if ( s ) {
				var infoWindow = new zyppmon.InfoWindow();
				infoWindow.showInfo(s);
			}
		},
		compareSystems: function(e) {
			var compareWindow = new zyppmon.CompareWindow();
			compareWindow.showCompareWindow(this.appInstance.systemsList);
		},
		analizeSystem: function(e) {
			var analizeWindow = new zyppmon.AnalizeWindow();
			analizeWindow.showAnalizeWindow(this.appInstance.systemsList);
		},
		loadData: function(event, system) {
			this._searchPackage.setValue("");
			this._archSelector.resetSelection();
			this._remSelector.resetSelection();
			this._table.setSourceURL(this.url);
			this._table.setParseFunc(function(el, idx) {
					if ( el.ver && el.rel ) el.ver_rel = el.ver+"-"+el.rel;
					if ( el.installTime ) el.installTime = new Date(el.installTime*1000);
					el.fInstTime = (el.fInstTime) ? (new Date(el.fInstTime*1000)) : el.installTime;
				});
			this._table.setFinalFunc(function() {
					this.setFilter();
					this._table.getTableModel().sortByColumn(0, true);
				}, this);
			this._table.loadData(system);
		},
		setTableFilter: function(arch, rem, name) {
			this.filter_arch = arch;
			this.filter_rem = rem;
			this.filter_name = name;
			var tm = this._table.getTableModel();
			var sidx = tm.getSortColumnIndex();
			var sasc = tm.isSortAscending();
			tm.resetHiddenRows();
			if ( arch && arch != "all" ) {
				tm.addNotRegex("^"+arch+"$", "arch", true);
			}
			if ( rem == 0 || rem == 1 ) {
				tm.addNumericFilter(rem == 0 ? "==" : "!=", 1, "removed");
			}
			if ( name && name > "" ) {
				if ( name.match(/^\".*\"$/) ) {
					tm.addNotRegex("^"+name.replace(/^\"(.*)\"$/,'$1')+"$", "name", true);
				} else {
					tm.addNotRegex(name, "name", true);
				}
			}
			tm.applyFilters();
			if ( sidx != -1 )
				tm.sortByColumn(sidx, sasc);
		},
		setPrevFilter: function () {
			this.setTableFilter(this.filter_arch, this.filter_act, this.filter_name);
		},
		_statusChange: function(e) {
			var vl = e.getData();
			var ovl = e.getOldData();
			if ( ((vl == this.__system.statuses.SRC_ONLINE) || (vl == this.__system.statuses.SRC_OK)) &&
					((ovl == this.__system.statuses.SRC_AUTHREQ) || (ovl == this.__system.statuses.SRC_OFFLINE) ||
					 	(ovl == this.__system.statuses.SRC_ERROR)) ) {
				this.loadData(null, this.__system);
			}
		},
		_newHistoryData: function(e) {
			var nd = e.getData();
			if ( !nd || !Array.isArray(nd) ) return;
			var tm = this._table.getTableModel();
			var sidx = tm.getSortColumnIndex();
			var sasc = tm.isSortAscending();
			tm.resetHiddenRows();
			var dt = tm.getDataAsMapArray();
			for ( var i = 0; i < nd.length; i++ ) {
				var op = nd[i].op;
				var name = nd[i].name;
				var arch = nd[i].arch;
				var ts = new Date(nd[i].ts*1000);
				if ( op == 'in' ) {
					dt.push({name: name, arch: arch, ver: nd[i].ver, rel: nd[i].rel, ver_rel: nd[i].ver+'-'+nd[i].rel,
							 installTime: ts, fInstTime: ts, mods: 0, repoAlias: nd[i].repoAlias, repoName: nd[i].repoName});
					continue;
				}
				for ( var j = 0; j < dt.length; j++ ) {
					if ( dt[j].name != name || dt[j].arch != arch ) continue;
					if ( op == 'up' || op == 'dn' || op == 'rf' ) {
						dt[j].ver = nd[i].ver;
						dt[j].rel = nd[i].rel;
						dt[j].ver_rel = nd[i].ver+'-'+nd[i].rel;
						dt[j].installTime = ts;
						dt[j].repoAlias = nd[i].repoAlias;
						dt[j].repoName = nd[i].repoName;
						dt[j].mods++;
					} else if ( op == 'rm' ) {
						dt[j].removed = 1;
						dt[j].mods++;
					}
					break;
				}
			}
			tm.setDataAsMapArray(dt);
			this.setFilter();
			if ( sidx != -1 )
				tm.sortByColumn(sidx, sasc);
		},
		loadSystem: function(sys) {
			if ( this.__system && sys.getUSID() == this.__system.getUSID() ) return;
			if ( this.__system ) {
				this.__system.removeListener("newHistoryData", this._newHistoryData, this);
				this.__system.removeListener("statusChange", this._statusChange, this);
			}
			this.__system = sys;
			sys.addListener("statusChange", this._statusChange, this);
			sys.addListener("newHistoryData", this._newHistoryData, this);
			this.url = sys.getURL("packages");
			this.loadData(null, sys);
		}
	}
});
