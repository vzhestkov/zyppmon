qx.Class.define("zyppmon.HistoryWindow", {
	extend : qx.ui.window.Window,
	include: [qx.locale.MTranslation],

	construct : function() {
		this.base(arguments, this.tr("WINDOW_HDR_HISTORY"));

		this._initInternals();

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
		// reload button
		var archSelectBox = new qx.ui.form.SelectBox().set({
			allowGrowY: false,
			alignY: "middle"
		});
		archSelectBox.addListener("changeSelection", function(e) {
			this.setFilter();
		}, this);
		this._archSelector = archSelectBox;
		var selections = {"all": this.tr("HISTORY_TOOLBAR_SLCT_ARCH_ALL"), "x86_64": "x86_64",
			"i386": "i386", "i586": "i586", "i686": "i686", "aarch64": "aarch64", "noarch": "noarch"};
		for (var key in selections) {
			var item = new qx.ui.form.ListItem(selections[key]);
			item.setUserData("value", key);
			archSelectBox.add(item);
		}
		var archFilterPart = new qx.ui.toolbar.Part();
		archFilterPart.add(archSelectBox);
		toolbar.add(archFilterPart);
		var actSelectBox = new qx.ui.form.SelectBox().set({
			allowGrowY: false,
			alignY: "middle"
		});
		actSelectBox.addListener("changeSelection", function(e) {
			this.setFilter();
		}, this);
		this._actSelector = actSelectBox;
		for (var key in this._actionsList) {
			var item = new qx.ui.form.ListItem(this._actionsList[key]);
			item.setUserData("value", key);
			actSelectBox.add(item);
		}
		var filterPart = new qx.ui.toolbar.Part();
		filterPart.add(actSelectBox);
		toolbar.add(filterPart);
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
		var clearFilterButton = new qx.ui.toolbar.Button(this.tr("HISTORY_TOOLBAR_BTN_CLEARFILTER"));
		clearFilterButton.addListener("execute", function (e) {
			this._searchPackage.setValue("");
			this._archSelector.resetSelection();
			this._actSelector.resetSelection();
			this.setTableFilter();
		}, this);
		toolbar.add(clearFilterButton);
		toolbar.addSpacer();
		var chartButton = new qx.ui.toolbar.Button(null, "icon/chart22.png");
		chartButton.set({toolTip: new qx.ui.tooltip.ToolTip(this.tr("HISTORY_TOOLBAR_BTN_CHART_HINT"))});
		chartButton.addListener("execute", function (e) {
			if ( !this.__system ) return;
			var chartWindow = new zyppmon.ChartWindow();
			chartWindow.showChart(this.__system, this._table);
		}, this);
		toolbar.add(chartButton);
		var reloadButton = new qx.ui.toolbar.Button(this.tr("HISTORY_TOOLBAR_BTN_RELOAD"), "icon/reload22.png");
		reloadButton.addListener("execute", this.loadData, this);
		toolbar.add(reloadButton);

		toolbar.setRemovePriority(archFilterPart, 2, false);
		toolbar.setRemovePriority(filterPart, 1, false);
		toolbar.setRemovePriority(clearFilterButton, 3, false);

		var ncr = new qx.ui.table.cellrenderer.Number();
		var dcr = new qx.ui.table.cellrenderer.Date();
		dcr.setDateFormat(new qx.util.format.DateFormat('yyyy-MM-dd HH:mm:ss'));
		var bcr = new qx.ui.table.cellrenderer.Boolean();
		var tmHistColumns = [
					{ id: "idx", label: this.tr("HISTORY_TBL_HDR_INDEX"),
						mandatory: true, visible: true, resizeBehaviour: { minWidth:50, maxWidth:60 }, cellRenderer: ncr },
					{ id: "time", label: this.tr("HISTORY_TBL_HDR_TIME"),
						mandatory: true, visible: true, resizeBehaviour: { minWidth:150, maxWidth:170 }, cellRenderer: dcr },
					{ id: "batch", label: this.tr("HISTORY_TBL_HDR_BATCH"),
						visible: true, resizeBehaviour: { minWidth:60, maxWidth:80 }, cellRenderer: ncr },
					{ id: "name", label: this.tr("HISTORY_TBL_HDR_NAME"),
						mandatory: true, visible: true, resizeBehaviour: { minWidth:300 } },
					{ id: "v_r", label: this.tr("HISTORY_TBL_HDR_VER_REL"),
						visible: true, resizeBehaviour: { minWidth:220, maxWidth:250 } },
					{ id: "arch", label: this.tr("HISTORY_TBL_HDR_ARCH"),
						visible: true, resizeBehaviour: { minWidth:80, maxWidth:100 } },
					{ id: "action", label: this.tr("HISTORY_TBL_HDR_ACTION"),
						visible: true, resizeBehaviour: { minWidth:80, maxWidth:100 } },
					{ id: "ver", label: this.tr("HISTORY_TBL_HDR_VERSION"),
						visible: false, resizeBehaviour: { minWidth:140, maxWidth:170 } },
					{ id: "rel", label: this.tr("HISTORY_TBL_HDR_RELEASE"),
						visible: false, resizeBehaviour: { minWidth:140, maxWidth:170 } },
					{ id: "preVer", label: this.tr("HISTORY_TBL_HDR_PRE_VERSION"),
						visible: false, resizeBehaviour: { minWidth:140, maxWidth:170 } },
					{ id: "preRel", label: this.tr("HISTORY_TBL_HDR_PRE_RELEASE"),
						visible: false, resizeBehaviour: { minWidth:140, maxWidth:170 } },
					{ id: "op", label: this.tr("HISTORY_TBL_HDR_ACTION_CODE"),
						visible: false },
					{ id: "repoName", label: this.tr("HISTORY_TBL_HDR_REPO_NAME"),
						visible: true },
					{ id: "repoAlias", label: this.tr("HISTORY_TBL_HDR_REPO_ALIAS"),
						visible: false, resizeBehaviour: { minWidth:200, maxWidth:230 } },
					{ id: "instd", label: this.tr("HISTORY_TBL_HDR_INSTD"),
						visible: false, cellRenderer: bcr },
				];
		var table = new zyppmon.table.ZyppmonTable(tmHistColumns);
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
		url : "/history",
		filter_arch : null,
		filter_act : null,
		filter_name : null,
		_actionsList: null,
		appInstance: null,
		__system: null,
		_lastID: null,
		__retryCount: 0,
		setAppInstance: function(app) {
			this.appInstance = app;
		},
		_initInternals: function() {
			this._actionsList = {
				"ALL": this.tr("HISTORY_TOOLBAR_SLCT_ACT_ALL"),
				"in": this.tr("HISTORY_TOOLBAR_SLCT_ACT_INSTALL"),
				"up": this.tr("HISTORY_TOOLBAR_SLCT_ACT_UPGRADE"),
				"dn": this.tr("HISTORY_TOOLBAR_SLCT_ACT_DOWNGRADE"),
				"rm": this.tr("HISTORY_TOOLBAR_SLCT_ACT_REMOVE"),
				"rf": this.tr("HISTORY_TOOLBAR_SLCT_ACT_REFRESH")
			};
		},
		setFilter: function() {
			if ( !(this._archSelector && this._actSelector && this._searchPackage) )
				return;
			this.setTableFilter(this._archSelector.getSelection()[0].getUserData("value"),
				this._actSelector.getSelection()[0].getUserData("value"),
				this._searchPackage.getValue());
		},
		doubleClick: function(e) {
			var rowIndex = e.getRow();
			var rd = this._table.getTableModel().getRowDataAsMap(rowIndex);
			this.setPackageToShow(rd.name, rd.arch);
		},
		setPackageToShow: function(name, arch) {
			this._searchPackage.setValue("\""+name+"\"");
			var selW = this._archSelector.getSelectables();
			for ( var i = 0; i < selW.length; i++ ) {
				var selE = selW[i].getUserData("value");
				if ( selW[i].getUserData("value") == arch ) {
					this._archSelector.setSelection(Array(selW[i]));
					break;
				}
			}
			this._actSelector.setSelection(Array(this._actSelector.getSelectables()[0]));
			this.setFilter();
		},
		setTableFilter: function(arch, act, name) {
			this.filter_arch = arch;
			this.filter_act = act;
			this.filter_name = name;
			var tm = this._table.getTableModel();
			var sidx = tm.getSortColumnIndex();
			var sasc = tm.isSortAscending();
			tm.resetHiddenRows();
			if ( arch && arch != "all" ) {
				tm.addNotRegex("^"+arch+"$", "arch", true);
			}
			if ( act && act != "ALL" ) {
				tm.addNotRegex("^"+act+"$", "op", true);
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
		loadData: function(event, system) {
			this._searchPackage.setValue("");
			this._archSelector.resetSelection();
			this._actSelector.resetSelection();
			this._table.setSourceURL(this.url);
			this._table.setParseDataFunc(function (data) {
					this._lastID = this.normalizeData(data);
				}, this);
			this._table.setFinalFunc(function() {
					this.setFilter();
					this._table.getTableModel().sortByColumn(0, true);
				}, this);
			this._table.loadData(system);
		},
		normalizeData: function (data) {
			var lhid = null;
			data.forEach(function(el) {
				el.v_r = el.ver+"-"+el.rel;
				if ( el.op && (el.op == "dn" || el.op == "up") && el.preVer && el.preRel ) {
					el.v_r = (el.op == "up") ? (el.preVer+"-"+el.preRel+" ⟶ "+el.ver+"-"+el.rel) :
							(el.ver+"-"+el.rel+" ⟵ "+el.preVer+"-"+el.preRel);
				}
				el.time = new Date(el.ts*1000);
				if ( el.op && this._actionsList[el.op] )
					el.action = new String(this._actionsList[el.op]);
				el.instd = el.instd ? true : false;
				if ( el.hid && (!lhid || lhid < el.hid) ) lhid = el.hid;
			}, this);
			return lhid;
		},
		requestHistoryUpdate: function(e) {
			if ( this._lastID == null ) return;
			console.log("requesting for update: LID>"+this._lastID);
			var req = new qx.io.remote.Request(this.url, "GET", "application/json");
			req.setTimeout(8000);
			if ( this.__system )
				this.__system.setReqAuthToken(req);
			req.setParameter("lastid", this._lastID, false);
			req.addListener("completed", this.appendHistoryData, this);
			req.addListener("aborted", this.retryHistoryUpdate, this);
			req.addListener("failed", this.retryHistoryUpdate, this);
			req.addListener("timeout", this.retryHistoryUpdate, this);
			req.send();
		},
		retryHistoryUpdate: function(e) {
			this.__retryCount++;
			if ( this.__retryCount > 20 ) {
				this.__retryCount = 0;
				return;
			}
			qx.event.Timer.once(this.requestHistoryUpdate, this, 3000);
		},
		appendHistoryData: function(e) {
			this.__retryCount = 0;
			var data = e.getContent();
			if ( !data || !Array.isArray(data.data) )
				return;
			data = data.data;
			this.__system.putNewHistoryData(data);
			var lhid = this.normalizeData(data);
//			console.log("historyUpdate req ("+this._lastID+") completed: "+lhid);
//			console.log("DATA: "+JSON.stringify(data));
			if ( lhid == null ) return;
			var tm = this._table.getTableModel();
//			console.log("DBG before: "+tm.__rowArr.length+" + "+data.length);
			var sidx = tm.getSortColumnIndex();
			var sasc = tm.isSortAscending();
			tm.resetHiddenRows();
			this._lastID = lhid;
			tm.setDataAsMapArray(tm.getDataAsMapArray().concat(data));
//			console.log("DBG after: "+tm.__rowArr.length+" + "+data.length);
			this.setPrevFilter();
			tm.sortByColumn(sidx, sasc);
		},
		_statusChange: function(e) {
			var vl = e.getData();
			var ovl = e.getOldData();
			if ( ((vl == this.__system.statuses.SRC_ONLINE) || (vl == this.__system.statuses.SRC_OK)) &&
					((ovl == this.__system.statuses.SRC_AUTHREQ) || (ovl == this.__system.statuses.SRC_OFFLINE) || (ovl == this.__system.statuses.SRC_ERROR)) ) {
				this.loadData(null, this.__system);
			}
		},
		_historyUpdate: function (e) {
			var hid = e.getData();
			var ohid = e.getOldData();
			if ( this._lastID == null ) return;
			var stype = this.__system.getType();
			if ( !(stype == "self" || stype == "host") )
				return;
			this.requestHistoryUpdate();
		},
		loadSystem: function(sys) {
			if ( this.__system && sys.getUSID() == this.__system.getUSID() ) return;
			if ( this.__system ) {
				this.__system.stopChecking();
				this.__system.removeListener("statusChange", this._statusChange, this);
				this.__system.removeListener("historyUpdated", this._historyUpdate, this);
			}
			this.__system = sys;
			sys.addListener("statusChange", this._statusChange, this);
			sys.startChecking();
			this.url = sys.getURL("history");
			var stype = sys.getType();
			if ( stype == "self" || stype == "host" ) {
				this.__lastHistoryID = sys.getLastHistoryID();
				sys.addListener("historyUpdated", this._historyUpdate, this);
			}
			this.loadData(null, sys);
		}
	}
});
