qx.Class.define("zyppmon.System", {
	extend: qx.core.Object,
	include : [qx.locale.MTranslation],
	construct: function(data, parentSystem, systemsList, authProv) {
		this.statuses_labels = [
			this.tr("ZYPPMON_SYSTEM_STATUS_OK"),
			this.tr("ZYPPMON_SYSTEM_STATUS_CHEKING"),
			this.tr("ZYPPMON_SYSTEM_STATUS_PENDING"),
			this.tr("ZYPPMON_SYSTEM_STATUS_IMPORTED"),
			this.tr("ZYPPMON_SYSTEM_STATUS_ONLINE"),
			this.tr("ZYPPMON_SYSTEM_STATUS_OFFLINE"),
			this.tr("ZYPPMON_SYSTEM_STATUS_REMOVED"),
			this.tr("ZYPPMON_SYSTEM_STATUS_ERROR"),
			this.tr("ZYPPMON_SYSTEM_STATUS_AUTHREQ")
		];
		if ( !data ) return;
		this.base(arguments);
		this.setName(data.name);
		this.setType(data.type);
		this.setUSID(data.usid);
		if ( parentSystem )
			this.setParentSystem(parentSystem);
		if ( systemsList )
			this.__systemsList = systemsList;
		if ( data.parentUSID )
			this.setParentUSID(data.parentUSID);
		if ( data.type == "file" || data.type == "template" ) {
			data.status = (data.ufl && data.file) ? this.statuses.SRC_OK : this.statuses.SRC_PENDING;
		} else if ( data.type == "self" || data.type == "host" ) {
			data.status = this.statuses.SRC_CHECKING;
		}
		this.__data = data;
		this.setStatus(data.status);
		this.setEnabled(data.enabled);
		this.addListener("stateChanged", function(e) {
			this.__data.enabled = e.getData();
		}, this);
		this.setLabel(parentSystem ? " - "+data.name+" @"+parentSystem.getName() : data.name);
		if ( authProv )
			this.__authProv = authProv;
		if ( data.type == "host" && data.host ) {
			this.setHost(data.host);
			if ( data.enabled && !parentSystem )
				this.__loadSubSystems();
		}
	},

	properties: {
		name: {
			init: "",
			event: "changeName"
		},
		label: {
			init: "",
			event: "changeLabel"
		},
		type: {
			init: ""
		},
		USID: {
			init: ""
		},
		parentSystem: {
			init: null
		},
		parentUSID: {
			init: null
		},
		host: {
			init: ""
		},
		proxied: {
			init: false
		},
		status: {
			init: 0,
			event: "statusChange"
		},
		enabled: {
			check: "Boolean",
			event: "stateChanged",
			init: true
		}
	},

	events: {
		checkChange: "qx.event.type.Data",
		historyUpdated: "qx.event.type.Data",
		systemsUpdated: "qx.event.type.Event",
		newHistoryData: "qx.event.type.Data",
		compareDataLoaded: "qx.event.type.Data",
		analizeDataLoaded: "qx.event.type.Data"
	},

	members: {
		statuses: {
			SRC_OK			:0,
			SRC_CHECKING	:1,
			SRC_PENDING		:2,
			SRC_IMPORTED	:3,
			SRC_ONLINE		:4,
			SRC_OFFLINE		:5,
			SRC_REMOVED		:6,
			SRC_ERROR		:7,
			SRC_AUTHREQ		:8
		},
		statuses_labels: null,
		__lastCheckData: null,
		__checkInterval: 5000,
		__authInProgress: 0,
		__compareRetry: 0,
		__waitCmpRetry: 0,
		__cmpLoadRslt: 0,
		__checkStatus: function() {
			if ( this.__checkState ) return;
			this.__checkState = 1;
			var req = new qx.io.remote.Request(this.__checkURL, "GET", "application/json");
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.addListener("completed", this.__onCheckReqOK, this);
			req.addListener("aborted", this.__onCheckReqFail, this);
			req.addListener("failed", this.__onCheckReqFail, this);
			req.addListener("timeout", this.__onCheckReqFail, this);
			req.send();
			if ( !this.__checkTimer && (this.getType() != "file") ) {
				this.__checkTimer = new qx.event.Timer(this.__checkInterval);
				this.__checkTimer.addListener("interval", this.__checkStatus, this);
				this.__checkTimer.start();
			}
		},
		__onCheckReqOK: function(e) {
			var dt = e ? e.getContent() : null;
			if ( dt.status && (dt.status == "error") && dt.error && (dt.error.match(/^AUTH_/)) ) {
				this.__checkState = 0;
				this.setStatus(this.statuses.SRC_AUTHREQ);
				this.auth();
				return 0;
			}
			if ( dt && dt["systems-ts"] && ((!this.__systemTs) || (this.__systemTs != dt["systems-ts"])) ) {
				if ( this.__systemTs ) this.fireEvent("systemsUpdated", qx.event.type.Event);
				this.__systemTs = dt["systems-ts"];
			}
			var ostatus = this.getStatus();
			this.setStatus((this.getType() == "file") ? this.statuses.SRC_OK : this.statuses.SRC_ONLINE);
			var vls = new Array("count", "installed", "removed", "systems-ts",
								"history-count", "history-dn", "history-in", "history-last-id",
								"history-rf", "history-rm", "history-up");
			var up = 0;
			if ( this.__lastCheckData ) {
				for ( var i = 0; i < vls.length; i++ ) {
					if ( dt[vls[i]] != this.__lastCheckData[vls[i]] ) {
						up = 1;
						break;
					}
				}
				if ( this.__historyLastID != dt["history-last-id"] ) {
					var ohid = this.__historyLastID;
					this.__historyLastID = dt["history-last-id"];
					this.fireDataEvent("historyUpdated", this.__historyLastID, ohid, false);
				}
			} else {
				up = 1;
				this.__historyLastID = dt["history-last-id"];
				this.fireDataEvent("historyUpdated", this.__historyLastID, null, false);
			}
			var odt = this.__lastCheckData;
			this.__lastCheckData = dt;
			if ( up ) this.fireDataEvent("checkChange", dt, odt, false);
			this.__checkState = 0;
		},
		__onCheckReqFail: function() {
			var ostatus = this.getStatus();
			this.setStatus(this.statuses.SRC_OFFLINE);
			this.__checkState = 0;
		},
		__onRenameCompleted: function(e) {
			var dt = e.getContent();
			if ( dt && dt.type && dt.name ) {
				this.setName(dt.name);
				this.__data.name = dt.name;
			}
		},
		__onSnapshotCompleted: function(e) {
			var dt = e.getContent();
		},
		__loadSubSystems: function() {
			var systemsURL = this.getURL("systems");
			this.__childSystems = new zyppmon.SystemsList(systemsURL, this, this.__authProv);
			this.__childSystems.addListener("systemsUpdated", function(e) {
					if ( this.__systemsList )
						this.__systemsList.addSubSystems(this, this.__childSystems);
				}, this);
		},
		update: function(data) {
			var up = 0;
			var od = this.__data;
			if ( od.timestamp != data.timestamp ) up++;
			if ( od.name != data.name ) this.setName(data.name);
			if ( od.enabled != data.enabled ) this.setName(data.enabled);
			if ( data.type == "file" ) {
				data.status = (data.ufl && data.file) ? this.statuses.SRC_OK : this.statuses.SRC_PENDING;
				this.setStatus(data.status);
			}
			this.__data = data;
			return up;
		},
		rename: function(name) {
			var req = new qx.io.remote.Request('/system/rename/'+this.getUSID(), "GET", "application/json");
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.setParameter("usn", name, false);
			req.addListener("completed", this.__onRenameCompleted, this);
			req.send();
		},
		createSnapshot: function() {
			var req = new qx.io.remote.Request('/system/snapshot/'+this.getUSID(), "GET", "application/json");
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.addListener("completed", this.__onSnapshotCompleted, this);
			req.send();
		},
		startChecking: function() {
			var t = this.getType();
			if ( this.__checkTimer ) {
				this.__checkTimer.start();
			} else if ( t == "self" || t == "host" ) {
				this.__checkURL = this.getURL("check");
				this.__checkStatus();
			} else if ( t == "file" ) {
				this.__checkURL = this.getURL("stat");
				this.__checkStatus();
			}
		},
		stopChecking: function(stop_self) {
			if ( this.getType() == "self" && !stop_self ) return;
			if ( this.__checkTimer ) this.__checkTimer.stop();
		},
		getData: function() {
			if ( !this.__data ) return null;
			this.__data.status = this.getStatus();
			return this.__data;
		},
		getCheckData: function() {
			return this.__lastCheckData;
		},
		getStatusLabel: function(status) {
			if ( this.statuses_labels[status] ) {
				return this.statuses_labels[status];
			}
			return null;
		},
		getLastHistoryID: function() {
			return this.__historyLastID ? this.__historyLastID : null;
		},
		__fixURL: function(u) {
			if ( !u.match(/^http(s|):\/\//i) && u.match(/:8843(\/|$)/) ) u = 'https://'+u;
			if ( !u.match(/^http(s|):\/\//i) ) u = 'http://'+u;
			u = u.replace(/(http:\/\/)([^\/:]+)(\/|$)/, '$1$2:8880$3');
			u = u.replace(/(https:\/\/)([^\/:]+)(\/|$)/, '$1$2:8843$3');
			u = u.replace(/$/, '/');
			u = u.replace(/\/*$/, '/');
			return u;
		},
		getURL: function(section, fromParent) {
			var parentSys = this.getParentSystem();
			var dt = this.__data;
			if ( !dt ) return null;
			var url = '/'+section;
			fromParent = (fromParent === true || this.getProxied());
			if ( dt.type == "file" || fromParent ) {
				url = '/'+dt.usid+url;
				if ( fromParent ) return url;
			}
			if ( dt.type == "host" || parentSys ) {
				if ( parentSys )
					dt = parentSys.getData();
				url = this.__fixURL(dt.host)+section;
			}
			return url;
		},
		setAuthProv: function(authProv) {
			this.__authProv = authProv;
		},
		setReqAuthToken: function(req) {
			if ( this.__authProv )
				this.__authProv.setReqAuthToken(req);
		},
		__authRet: function(e) {
			this.__authProv.removeListener("loginSucceeded", this.__authRet, this);
			this.__authProv.removeListener("loginFailed", this.__authRet, this);
			this.__authInProgress = 0;
		},
		auth: function() {
			if ( this.__authInProgress ) return;
			this.__authInProgress = 1;
			this.__authProv.addListener("loginSucceeded", this.__authRet, this);
			this.__authProv.addListener("loginFailed", this.__authRet, this);
			this._loginWindow = new zyppmon.LoginWindow(this.__authProv, true, this);
			this._loginWindow.addListener("close", this.__authRet, this);
			this._loginWindow.open();
			return this.__authProv;
		},
		putNewHistoryData: function(data) {
			this.fireDataEvent("newHistoryData", data, null, false);
		},
		compare: function(system) {
			var sys = system;
			if ( sys ) {
				this.__cmpSystem = sys;
				this.__compareRetry = 0;
			} else {
				sys = this.__cmpSystem;
				this.__compareRetry++;
				if ( this.__compareRetry > 10 ) {
					this.__compareRetry = 0;
					this.__cmpID = null;
					return;
				}
			}
			var req = new qx.io.remote.Request('/compare/'+this.getUSID()+'/'+sys.getUSID(), "GET", "application/json");
			req.setTimeout(8000);
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.addListener("completed", this.__onCompareCompleted, this);
			req.addListener("aborted", this.__onCompareReqFail, this);
			req.addListener("failed", this.__onCompareReqFail, this);
			req.addListener("timeout", this.__onCompareReqFail, this);
			req.send();
		},
		__onCompareCompleted: function(e) {
			var dt = e.getContent();
			if ( dt.cmpid && dt.status ) {
				this.__cmpID = dt.cmpid;
				if ( dt.status == 'pending' ) {
					qx.event.Timer.once(this.__waitCompare, this, 1000);
				} else if ( dt.status == 'ok' ) {
					this.__waitCmpRetry = 0;
					this.__loadCompare();
				} else {
					this.__compareRetry = 0;
					this.__cmpID = null;
				}
			}
		},
		__onCompareReqFail: function(e) {
			if ( !this.__cmpSystem ) return;
			qx.event.Timer.once(this.compare, this, 1000);
		},
		__waitCompare: function(e) {
			if ( !this.__cmpID ) return;
			this.__waitCmpRetry++;
			if ( this.__waitCmpRetry > 10 ) {
				this.__waitCmpRetry = 0;
				return;
			}
			var req = new qx.io.remote.Request('/compare/get/'+this.__cmpID+'/check', "GET", "application/json");
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.addListener("completed", this.__onCompareCompleted, this);
			req.addListener("aborted", this.__waitCompare, this);
			req.addListener("failed", this.__waitCompare, this);
			req.addListener("timeout", this.__waitCompare, this);
			req.send();
		},
		__loadCompare: function() {
			if ( !this.__cmpID ) return;
			var sects = Array('info_cmp', 'stat_cmp', 'packages_cmp');
			this.__cmpLoadRslt = 0;
			this.__cmpResult = null;
			sects.forEach(function (sect) {
					var req = new qx.io.remote.Request('/compare/get/'+this.__cmpID+'/'+sect, "GET", "application/json");
					req.setTimeout(8000);
					if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
					req.setParameter("token", this.__cmpID+'/'+sect, false);
					req.addListener("completed", this.__onCmpLoadCompleted, this);
					req.send();
				}, this);
		},
		__onCmpLoadCompleted: function(e) {
			var dt = e.getContent();
			if ( !(dt.ctrl && dt.data && dt.ctrl.section && dt.ctrl.token) ) return;
			var sect = dt.ctrl.section;
			var token = dt.ctrl.token;
			var nxt = dt.ctrl.next;
			var rbits = {
				info_cmp: 1,
				stat_cmp: 2,
				packages_cmp: 4
			};
			if ( !this.__cmpResult ) this.__cmpResult = {};
			if ( !this.__cmpResult[sect] ) {
				this.__cmpResult[sect] = dt.data;
			} else {
				this.__cmpResult[sect] = this.__cmpResult[sect].concat(dt.data);
			}
			if ( nxt ) {
				var req = new qx.io.remote.Request('/compare/get/'+this.__cmpID+'/'+sect, "GET", "application/json");
				req.setTimeout(8000);
				if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
				req.setParameter("token", token, false);
				req.setParameter("next", nxt, false);
				req.addListener("completed", this.__onCmpLoadCompleted, this);
				req.send();
			} else {
				this.__cmpLoadRslt |= rbits[sect];
			}
			if ( this.__cmpLoadRslt == 7 ) {
				this.fireDataEvent("compareDataLoaded", this.__cmpResult, null, false);
				delete this.__cmpResult;
			}
		},
		analize: function(system) {
			if ( this.getType() != 'template' ) return;
			var sys = system;
			if ( sys ) {
				this.__analizeSystem = sys;
				this.__analizeRetry = 0;
			} else {
				sys = this.__analizeSystem;
				this.__analizeRetry++;
				if ( this.__analizeRetry > 10 ) {
					this.__analizeRetry = 0;
					this.__analizeID = null;
					return;
				}
			}
			var req = new qx.io.remote.Request('/templates/analize', "GET", "application/json");
			req.setTimeout(8000);
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.setParameter("system", sys.getUSID(), false);
			req.setParameter("template", this.getUSID(), false);
			req.addListener("completed", this.__onAnalizeCompleted, this);
			req.addListener("aborted", this.__onAnalizeReqFail, this);
			req.addListener("failed", this.__onAnalizeReqFail, this);
			req.addListener("timeout", this.__onAnalizeReqFail, this);
			req.send();
		},
		__onAnalizeCompleted: function(e) {
			var dt = e.getContent();
			if ( dt.analizeid && dt.status ) {
				this.__analizeID = dt.analizeid;
				if ( dt.status == 'pending' ) {
					qx.event.Timer.once(this.__waitAnalize, this, 1000);
				} else if ( dt.status == 'ok' ) {
					this.__waitAnalizeRetry = 0;
					this.__loadAnalize();
				} else {
					this.__analizeRetry = 0;
					this.__analizeID = null;
				}
			}
		},
		__onAnalizeReqFail: function(e) {
			if ( !this.__analizeSystem ) return;
			qx.event.Timer.once(this.analize, this, 1000);
		},
		__waitAnalize: function(e) {
			if ( !this.__analizeID ) return;
			this.__waitAnalizeRetry++;
			if ( this.__waitAnalizeRetry > 10 ) {
				this.__waitAnalizeRetry = 0;
				return;
			}
			var req = new qx.io.remote.Request('/templates/checkAnalize', "GET", "application/json");
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.setParameter("analizeid", this.__analizeID, false);
			req.addListener("completed", this.__onAnalizeCompleted, this);
			req.addListener("aborted", this.__waitAnalize, this);
			req.addListener("failed", this.__waitAnalize, this);
			req.addListener("timeout", this.__waitAnalize, this);
			req.send();
		},
		__loadAnalize: function() {
			if ( !this.__analizeID ) return;
			var req = new qx.io.remote.Request('/templates/getAnalize', "GET", "application/json");
			req.setTimeout(8000);
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.setParameter("analizeid", this.__analizeID, false);
			req.addListener("completed", this.__onAnalizeLoadCompleted, this);
			req.send();
		},
		__onAnalizeLoadCompleted: function(e) {
			var dt = e.getContent();
			this.fireDataEvent("analizeDataLoaded", dt, null, false);
		},
		setActive: function() {
			if ( this.getStatus() == this.statuses.SRC_AUTHREQ )
				this.auth();
		},
		destroy: function() {
			delete this.__authProv;
			delete this.__data;
			this.stopChecking();
			delete this.__checkTimer;
		}
	}
});
