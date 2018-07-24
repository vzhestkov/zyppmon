qx.Class.define("zyppmon.SystemsList", {
	extend: qx.data.Array,
	construct: function(url, parentSystem, authProv) {
		this.base(arguments);
		if ( url )
			this.__url = url;
		if ( parentSystem ) {
			this.__parentSystem = parentSystem;
			this.__parentUSID = parentSystem.getUSID();
		}
		if ( authProv )
			this.__authProv = authProv;
		this.__loadSystems();
	},

	events: {
		changeActive: "qx.event.type.Data",
		selfSystemLoaded: "qx.event.type.Event",
		systemsUpdated: "qx.event.type.Event",
		statusesUpdated: "qx.event.type.Event",
		statesUpdated: "qx.event.type.Event"
	},

	members: {
		__url: "/systems",
		__authProv: null,
		__loadRetryCount: 0,
		__method: 0,
		__loadSystems: function() {
			if ( this.__method == 1 && this.__parentSystem ) {
				this.__url = this.__parentSystem.getURL('systems', true);
			} else if ( this.__origURL )  {
				this.__url = this.__origURL;
			}
			var req = new qx.io.remote.Request(this.__url, "GET", "application/json");
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.addListener("completed", this.__onReqCompleted, this);
			req.addListener("aborted", this.__onReqFailed, this);
			req.addListener("failed", this.__onReqFailed, this);
			req.addListener("timeout", this.__onReqFailed, this);
			req.send();
		},
		__onReqCompleted: function(e) {
			var data = e.getContent();
			if ( data.status && (data.status == "error") && data.error && (data.error.match(/^AUTH_/)) &&
			   			this.__parentSystem && (this.__parentSystem.getType() == "host") ) {
				if ( this.__method == 0 ) {
					this.__origURL = this.__url;
					this.__method = 1;
					this.__loadSystems();
					return;
				}
				this.__authProv = this.__parentSystem.auth();
				this.__authProv.addListener("loginSucceeded", this.__loadSystems, this);
			}
			if ( !Array.isArray(data) ) return;
			if ( this.__method == 1 && this.__parentSystem )
				this.__parentSystem.setProxied(true);
			this.__loadRetryCount = 0;
			var d = qx.module.Cookie.get("disabled_systems");
			if ( d ) d = d.split(":");
			var i;
			var c = 0;
			for ( i = this.getLength()-1; i >= 0; i-- ) {
				if ( this.getItem(i).getParentSystem() )
					continue;
				var usid = this.getItem(i).getUSID();
				var f = 0;
				for ( var j = 0; j < data.length; j++ ) {
					if ( data[j].usid == usid ) {
						f = 1;
						break;
					}
				}
				if ( !f ) {
					this.removeAt(i);
					c++;
				}
			}
			var setProxied = (this.__parentSystem) ? this.__parentSystem.getProxied() : false;
			for ( i = 0; i < data.length; i++ ) {
				data[i].enabled = (d && d.indexOf(data[i].usid) != -1) ? false : true;
				if ( this.__parentUSID )
					data[i].parentUSID = this.__parentUSID;
				var s = this.getByUSID(data[i].usid);
				if ( s ) {
					if ( s.update(data[i]) ) c++;
				} else {
					var ns = new zyppmon.System(data[i], this.__parentSystem, this.__parentSystem ? null : this, this.__authProv);
					if ( setProxied ) ns.setProxied(true);
					var tp = ns.getType();
					if ( tp == "self" || tp == "host" ) {
						ns.addListener("statusChange", function(e) {
								this.fireEvent("statusesUpdated", qx.event.type.Event);
							}, this);
					}
					this.push(ns);
					c++;
				}
			}
			var selfsys = this.getSelfSystem();
			if ( c ) this.fireEvent("systemsUpdated", qx.event.type.Event);
			if ( selfsys && !this.__selfSystem ) {
				this.__selfSystem = selfsys;
				this.fireEvent("selfSystemLoaded", qx.event.type.Event);
				selfsys.addListener("systemsUpdated", this.__loadSystems, this);
			}
			this.fireEvent("statesUpdated", qx.event.type.Event);
		},
		__onReqFailed: function(e) {
			this.__loadRetryCount++;
			if ( this.__loadRetryCount > 20 ) {
				this.__loadRetryCount = 0;
				return;
			}
			qx.event.Timer.once(this.__loadSystems, this, 3000);
		},
		__onRemoveCompleted: function(e) {
			var dt = e.getContent();
			if ( dt && dt.usid ) {
				var s = this.getByUSID(dt.usid);
				if (s) this.remove(s);
			}
		},
		removeSystem: function(system) {
			var usid = system.getUSID();
			var req = new qx.io.remote.Request('/system/remove/'+usid, "GET", "application/json");
			if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
			req.addListener("completed", this.__onRemoveCompleted, this);
			req.send();
		},
		addSubSystems: function(system, subSystemsList) {
			var c = 0;
			var pidx = this.indexOf(system);
			subSystemsList.forEach(function (sysToAdd) {
					if ( sysToAdd.getType() == "self" )
						return;
					if ( this.getByUSID(sysToAdd.getUSID()) )
						return;
					this.insertAt(++pidx, sysToAdd);
					c++;
				}, this);
			if ( c ) this.fireEvent("systemsUpdated", qx.event.type.Event);
		},
		getSelfSystem: function() {
			for ( var i = 0; i < this.getLength(); i++ ) {
				var s = this.getItem(i);
				if ( s.getType() == "self" ) return s;
			}
			return null;
		},
		getByUSID: function(usid) {
			for ( var i = 0; i < this.getLength(); i++ ) {
				var s = this.getItem(i);
				if ( s.getUSID() == usid ) return s;
			}
			return null;
		},
		saveStates: function(order) {
			var d = "";
			for ( var i = 0; i < this.getLength(); i++ ) {
				var s = this.getItem(i);
				if ( !s.getEnabled() ) {
					d += (d == "" ? "" : ":")+s.getUSID();
				}
			}
			qx.module.Cookie.set("disabled_systems", d, 365);
			if ( order ) {
				this.sort(function(a, b) {
					var ai = order.indexOf(a.getUSID());
					var bi = order.indexOf(b.getUSID());
					if ( ai > bi ) {
						return -1;
					} else if ( ai < bi ) {
						return 1;
					}
					return 0;
				});
				var uord = "";
				for ( var i = 0; i < this.getLength(); i++ ) {
					var s = this.getItem(i);
					uord += (uord == "" ? "" : ";")+s.getUSID();
				}
				var req = new qx.io.remote.Request('/systems/setOrder', "GET", "application/json");
				if ( this.__authProv ) this.__authProv.setReqAuthToken(req);
				req.setParameter("order", uord, false);
				req.send();
			}
			this.fireEvent("statesUpdated", qx.event.type.Event);
		},
		setActive: function(active) {
			var old = this.__active ? this.__active : old;
			this.__active = active;
			this.__active.setActive();
			this.fireDataEvent("changeActive", this.__active, old, false);
		},
		getActive: function() {
			if ( this.__active ) return this.__active;
			var s = this.getSelfSystem();
			if ( s ) {
				this.__active = s;
				return s;
			}
			return null;
		},
		startChecking: function() {
			for ( var i = 0; i < this.getLength(); i++ ) {
				var s = this.getItem(i);
				s.startChecking();
			}
		},
		stopChecking: function(stop_self) {
			for ( var i = 0; i < this.getLength(); i++ ) {
				var s = this.getItem(i);
				s.stopChecking(stop_self);
			}
		},
		destroy: function() {
			for ( var i = 0; i < this.getLength(); i++ ) {
				var s = this.getItem(i);
				s.destroy();
			}
			this.removeAll();
			delete this.__parentSystem;
			delete this.__authProv;
		}
	}
});
