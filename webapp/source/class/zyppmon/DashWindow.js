qx.Class.define("zyppmon.DashWindow", {
	extend : qx.ui.window.Window,
	include : [qx.locale.MTranslation],
	construct : function(app) {
		this.base(arguments, this.tr("WINDOW_HDR_DASHBOARD"));
		if ( !app ) return;
		this.__app = app;
		this.setShowClose(false);
		this.setShowMinimize(false);
		this.setShowMaximize(false);
		this.setAllowMaximize(false);
		this.maximize();

		this._sysRef = new zyppmon.System();

		// add the layout
		var layout = new qx.ui.layout.VBox;
		this.setLayout(layout);
		this.setContentPadding(0);

		var toolbar = new qx.ui.toolbar.ToolBar();
		this.add(toolbar);
		toolbar.addSpacer();
		var settingsButton = new qx.ui.toolbar.Button(null, "icon/settings22.png");
		settingsButton.addListener("execute", function(e) {
				if ( this.__app ) this.__app.showSettings();
			}, this);
		settingsButton.set({toolTip: new qx.ui.tooltip.ToolTip(this.tr("DASH_TOOLBAR_BTN_SETTINGS_HINT"))});
		toolbar.add(settingsButton);
		if ( app._authProv.loginRequired ) {
			var logoutButton = new qx.ui.toolbar.Button(null, "icon/logout22.png");
			logoutButton.addListener("execute", function(e) {
					if ( this.__app ) this.__app.logout();
				}, this);
			logoutButton.set({toolTip: new qx.ui.tooltip.ToolTip(this.tr("DASH_TOOLBAR_BTN_LOGOUT_HINT"))});
			toolbar.add(logoutButton);
		}

		this._systemLabel = new qx.ui.basic.Label("").set({
					font: "bold",
					allowGrowX: true,
					textAlign: "center",
					paddingLeft: 8,
					paddingRight: 8,
					paddingTop: 2,
					paddingBottom: 2
				});
		this.add(this._systemLabel);

		this._table = this.createTable();
		this.add(this._table, { flex: 1});
		qx.locale.Manager.getInstance().addListener("changeLocale", this.changeLocale, this);
	},

	members: {
		fields: null,
		prevData: null,
		_sysRef: null,
		__system: null,
		_systemLabel: null,
		createTable: function() {
			// table model
			var tableModel = this._tableModel = new qx.ui.table.model.Filtered();
			tableModel.setColumns([this.tr("DASH_TBL_HDR_LABEL"), this.tr("DASH_TBL_HDR_VALUE")], ["label", "value"]);

			// table
			var custom = {
				tableColumnModel : function(obj) {
					return new qx.ui.table.columnmodel.Resize(obj);
				}
			};
			var table = new qx.ui.table.Table(tableModel, custom);
			table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
			var tcm = table.getTableColumnModel();
			var rtcr = new qx.ui.table.cellrenderer.String("right");
			tcm.setDataCellRenderer(0, rtcr);
			var statusCr = new qx.ui.table.cellrenderer.Conditional("right");
			var colorMgr = qx.theme.manager.Color.getInstance();
			statusCr.addRegex("^[^0-9]", "center", null, null, "bold");
			statusCr.addRegex("^"+this._sysRef.getStatusLabel(this._sysRef.statuses.SRC_ONLINE)+"$",
							  	"center", colorMgr.resolve("dashboard-status-online"), null, "bold");
			statusCr.addRegex("^"+this._sysRef.getStatusLabel(this._sysRef.statuses.SRC_OFFLINE)+"$",
							  	"center", colorMgr.resolve("dashboard-status-offline"), null, "bold");
			tcm.setDataCellRenderer(1, statusCr);
			var resizeBehavior = tcm.getBehavior();
			resizeBehavior.set(0, { width:"1*", minWidth:40, maxWidth:80 });
			resizeBehavior.setWidth(0, "64%");
			table.setHeaderCellsVisible(false);
			table.setStatusBarVisible(false);
			this.fillFields();
			return table;
		},
		fillFields: function () {
			var fields = this.getLabels();
			if ( this.fields == null ) {
				this.fields = fields;
				this._tableModel.setDataAsMapArray(this.fields);
				return;
			}
			for ( var i = 0; i < this.fields.length; i++ ) {
				for ( var j = 0; j < fields.length; j++ ) {
					if ( this.fields[i].name == fields[j].name ) {
						this.fields[i].label = fields[j].label;
					}
				}
			}
			this._tableModel.setDataAsMapArray(this.fields);
		},
		changeLocale: function () {
			var tcm = this._table.getTableColumnModel();
			var statusCr = new qx.ui.table.cellrenderer.Conditional("right", null, null, null);
			var colorMgr = qx.theme.manager.Color.getInstance();
			statusCr.addRegex("^[^0-9]", "center", null, null, "bold");
			statusCr.addRegex("^"+this._sysRef.getStatusLabel(this._sysRef.statuses.SRC_ONLINE)+"$",
							  	"center", colorMgr.resolve("dashboard-status-online"), null, "bold");
			statusCr.addRegex("^"+this._sysRef.getStatusLabel(this._sysRef.statuses.SRC_OFFLINE)+"$",
							  	"center", colorMgr.resolve("dashboard-status-offline"), null, "bold");
			tcm.setDataCellRenderer(1, statusCr);
			this.fillFields();
			this.setConnStatus(this._status);
		},
		setConnStatus: function (status) {
			this._status = status;
			for ( var i = 0; i < this.fields.length; i++ ) {
				if ( this.fields[i].name == "status" ) {
					this._tableModel.setValue(1,i,this._sysRef.getStatusLabel(status));
				}
			}
		},
		updateTableData: function (data) {
			if ( !data ) return;
			for ( var i = 0; i < this.fields.length; i++ ) {
				this.fields[i].value = data[this.fields[i].name];
				if ( this.prevData == null || this.fields[i].value != this.prevData[this.fields[i].name] ) {
					this._tableModel.setValue(1,i,this.fields[i].value);
				}
			}
			this.prevData = data;
		},
		_checkChange: function (e) {
			var dt = e.getData();
			if ( dt ) this.updateTableData(dt);
			this.setConnStatus(this.__system.getStatus());
		},
		_statusChange: function (e) {
			var dt = e.getData();
			if ( dt ) this.setConnStatus(dt);
		},
		loadSystem: function(sys) {
			if ( this.__system && sys.getUSID() == this.__system.getUSID() ) return;
			if ( this.__system ) {
				this.__system.stopChecking();
				this.__system.removeListener("checkChange", this._checkChange, this);
				this.__system.removeListener("statusChange", this._statusChange, this);
			}
			this.__system = sys;
			this.updateTableData(sys.getCheckData());
			this.setConnStatus(sys.getStatus());
			this._systemLabel.setValue(sys.getName());
			sys.addListener("checkChange", this._checkChange, this);
			sys.addListener("statusChange", this._statusChange, this);
			sys.startChecking();
		},
		getLabels: function() {
			return [
					{"name": "count", "label": this.tr("DASH_LBL_TOTAL")},
					{"name": "installed", "label": this.tr("DASH_LBL_INSTALLED")},
					{"name": "removed", "label": this.tr("DASH_LBL_REMOVED")},
					{"name": "history-count", "label": this.tr("DASH_LBL_HISTORY_COUNT")},
					{"name": "history-in", "label": this.tr("DASH_LBL_HISTORY_INSTALLS")},
					{"name": "history-rm", "label": this.tr("DASH_LBL_HISTORY_REMOVES")},
					{"name": "history-up", "label": this.tr("DASH_LBL_HISTORY_UPGRADES")},
					{"name": "history-dn", "label": this.tr("DASH_LBL_HISTORY_DOWNGRADES")},
					{"name": "history-rf", "label": this.tr("DASH_LBL_HISTORY_REFRESHES")},
					{"name": "status", "label": this.tr("DASH_LBL_STATUS")}
			];
		}
	},
	statics: {
		getLabels: function() {
			var _w = new zyppmon.DashWindow();
			var _l = _w.getLabels();
			_w.destroy();
			return _l;
		}
	}
});
