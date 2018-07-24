qx.Class.define("zyppmon.InfoWindow", {
	extend : qx.ui.window.Window,
	include : [qx.locale.MTranslation],
	construct : function(noinit) {
		this.base(arguments, this.tr("WINDOW_HDR_INFO"));
		if (noinit) return;
		
		this.setShowMinimize(false);
		this.setShowMaximize(false);
		this.setAllowMaximize(false);
		this.setResizable(true);
		this.setModal(true);
		this.setWidth(600);

		// add the layout
		var layout = new qx.ui.layout.VBox;
		this.setLayout(layout);
		this.setContentPadding(0);
		this._table = this.createTable();
		this.add(this._table, {flex: 1});

		this.moveTo(Math.round((qx.bom.Viewport.getWidth()-this.getWidth())/2), 80);

		this.addListener("close", function (e) {
			this.destroy();
		}, this);
	},

	members: {
		createTable: function() {
			var rtcr = new qx.ui.table.cellrenderer.String("right");
			var tmInfoColumns = [
						{ id: "label", label: this.tr("INFO_TBL_HDR_LABEL"),
							mandatory: true, visible: true, resizeBehaviour: { minWidth:250, maxWidth:400 }, width: "40%", cellRenderer: rtcr },
						{ id: "value", label: this.tr("INFO_TBL_HDR_VALUE"),
							mandatory: true, visible: true, resizeBehaviour: { minWidth:350, maxWidth:500 } }
				];
			var table = new zyppmon.table.ZyppmonTable(tmInfoColumns);
			table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
			table.setHeaderCellsVisible(false);
			table.setStatusBarVisible(false);
			return table;
		},
		showInfo: function(system) {
			this.setCaption(this.tr("WINDOW_HDR_INFO")+" - "+system.getName());
			var req = new qx.io.remote.Request(system.getURL("info"), "GET", "application/json");
			system.setReqAuthToken(req);
			req.addListener("completed", this._onReqComplete, this);
			req.send();
			this.open();
		},
		_onReqComplete: function(e) {
			var data = e.getContent();
			var tm = this._table.getTableModel();
			var flds = this.getLabels();
			for ( var i = 0; i < flds.length; i++ ) {
				var nm = flds[i].name;
				var lbl = flds[i].label.replace(/^INFO_LBL_/, '');
				if ( nm in data ) {
					if ( data[nm] ) {
						tm.addRowsAsMapArray([{label: lbl+":", value: data[nm]}]);
					}
					delete data[nm];
				}
			}
			for (var prop in data) {
				tm.addRowsAsMapArray([{label: prop+":", value: data[prop]}]);
			}
		},
		getLabels: function() {
			return [
				{name: "NAME",				label: this.tr("INFO_LBL_NAME")},
				{name: "VERSION",			label: this.tr("INFO_LBL_VERSION")},
				{name: "VERSION_ID",		label: this.tr("INFO_LBL_VERSION_ID")},
				{name: "PRETTY_NAME",		label: this.tr("INFO_LBL_PRETTY_NAME")},
				{name: "SUSE_NAME",			label: this.tr("INFO_LBL_SUSE_NAME")},
				{name: "SUSE_VERSION",		label: this.tr("INFO_LBL_SUSE_VERSION")},
				{name: "SUSE_PATCHLEVEL",	label: this.tr("INFO_LBL_SUSE_PATCHLEVEL")},
				{name: "SUSE_CODENAME",		label: this.tr("INFO_LBL_SUSE_CODENAME")},
				{name: "NOVELL_NAME",		label: this.tr("INFO_LBL_NOVELL_NAME")},
				{name: "NOVELL_VERSION",	label: this.tr("INFO_LBL_NOVELL_VERSION")},
				{name: "NOVELL_PATCHLEVEL",	label: this.tr("INFO_LBL_NOVELL_PATCHLEVEL")},
				{name: "CPE_NAME",			label: this.tr("INFO_LBL_CPE_NAME")},
				{name: "ID",				label: this.tr("INFO_LBL_ID")},
				{name: "ID_LIKE",			label: this.tr("INFO_LBL_ID_LIKE")},
				{name: "HOME_URL",			label: this.tr("INFO_LBL_HOME_URL")},
				{name: "BUG_REPORT_URL",	label: this.tr("INFO_LBL_BUG_REPORT_URL")},
				{name: "ANSI_COLOR",		label: this.tr("INFO_LBL_ANSI_COLOR")},
				{name: "ENV_HOST",			label: this.tr("INFO_LBL_ENV_HOST")},
				{name: "ENV_HOSTNAME",		label: this.tr("INFO_LBL_ENV_HOSTNAME")},
				{name: "ENV_CPU",			label: this.tr("INFO_LBL_ENV_CPU")},
				{name: "ENV_HOSTTYPE",		label: this.tr("INFO_LBL_ENV_HOSTTYPE")},
				{name: "ENV_MACHTYPE",		label: this.tr("INFO_LBL_ENV_MACHTYPE")},
				{name: "ENV_OSTYPE",		label: this.tr("INFO_LBL_ENV_OSTYPE")},
				{name: "LSB_DISTRIB_ID",			label: this.tr("INFO_LBL_LSB_DISTRIB_ID")},
				{name: "LSB_DISTRIB_RELEASE",		label: this.tr("INFO_LBL_LSB_DISTRIB_RELEASE")},
				{name: "LSB_DISTRIB_CODENAME",		label: this.tr("INFO_LBL_LSB_DISTRIB_CODENAME")},
				{name: "LSB_DISTRIB_DESCRIPTION",	label: this.tr("INFO_LBL_LSB_DISTRIB_DESCRIPTION")},
				{name: "LSB_VERSION",				label: this.tr("INFO_LBL_LSB_VERSION")}
			];
		}
	},
	statics: {
		getLabels: function() {
			var _w = new zyppmon.InfoWindow(true);
			var _l = _w.getLabels();
			_w.destroy();
			return _l;
		}
	}
});
