qx.Class.define("zyppmon.AuthProvider", {
	extend: qx.core.Object,
	include : [qx.locale.MTranslation],
	construct: function(system) {
		this.base(arguments);
		this._checkIfLoginRequired();
	},

	events: {
		loginRequired: "qx.event.type.Data",
		loginSucceeded: "qx.event.type.Data",
		loginFailed: "qx.event.type.Data"
	},

	members: {
		_urlAuthGetInfo: "/auth/getInfo",
		_urlAuthGetKey: "/auth/getKey",
		_urlAuthLogin: "/auth/login",
		__authToken: null,
		__host: null,
		_hosts: {},
		getToken: function() {
			return this.__authToken;
		},
		addSystem: function(system) {
			if ( system && system.getType() == "host" ) {
				var host = this.getRootHost(system.getHost());
				if ( host == "" ) return;
				this._hosts[host] = {
						_urlAuthGetInfo: system.getURL('auth/getInfo'),
						_urlAuthGetKey: system.getURL('auth/getKey'),
						_urlAuthLogin: system.getURL('auth/login')
					};
				this._checkIfLoginRequired(host);
			}
		},
		getRootHost: function(u) {
			var m;
			if ( m = u.match(/^(http(s|):\/\/([^\/]+))/i) ) {
				u = m[1];
			} else if ( m = u.match(/^([^\/]*)/) ) {
				u = m[1];
			}
			return u;
		},
		_checkIfLoginRequired: function(host) {
			var url = this._urlAuthGetInfo;
			if ( host ) {
				if ( this._hosts[host] ) {
					url = this._hosts[host]._urlAuthGetInfo;
					this.__host = host;
				} else {
					return;
				}
			}
			var req = new qx.io.remote.Request(url, "GET", "application/json");
			req.addListener("completed", this._authRetIfRequired, this);
			req.addListener("aborted", this._authRetIfRequired, this);
			req.addListener("failed", this._authRetIfRequired, this);
			req.addListener("timeout", this._authRetIfRequired, this);
			req.send();
		},
		_authRetIfRequired: function(e) {
			var data = e.getContent();
			if ( data && data.status && data.status == "ok" ) {
				this.fireDataEvent("loginSucceeded", data, null, false);
			} else {
				this.fireDataEvent("loginRequired", data, null, false);
			}
			this.__host = null;
		},
		_authLoginReply: function(e) {
			var data = e.getContent();
			if ( data && data.status && data.status == "ok" && data.ok && data.ok == "AUTH_OK" && data.authToken ) {
				if ( this.__host ) {
					this._hosts[this.__host].__authToken = data.authToken;
				} else {
					this.__authToken = data.authToken;
				}
				this.fireDataEvent("loginSucceeded", data, null, false);
			} else {
				this.fireDataEvent("loginFailed", data, null, false);
			}
			this.__host = null;
		},
		_authReplyAborted: function(e) {
			this.fireDataEvent("loginFailed", {"error":"AUTH_ABORTED","msg":this.tr("AUTHPROV_REQ_ABORTED").toString(),"status":"error"}, null, false);
			this.__host = null;
		},
		_authReplyFailed: function(e) {
			this.fireDataEvent("loginFailed", {"error":"AUTH_FAILED","msg":this.tr("AUTHPROV_REQ_FAILED").toString(),"status":"error"}, null, false);
			this.__host = null;
		},
		_authReplyTimeout: function(e) {
			this.fireDataEvent("loginFailed", {"error":"AUTH_TIMEOUT","msg":this.tr("AUTHPROV_REQ_TIMEOUT").toString(),"status":"error"}, null, false);
			this.__host = null;
		},
		/**
		* @ignore(CryptoJS.AES.encrypt)
		**/
		_authKeyReply: function(e) {
			var data = e.getContent();
			var authKey = data.authKey;
			var encLogin = CryptoJS.AES.encrypt(this.__loginName, authKey).toString();
			var encPasswd = CryptoJS.AES.encrypt(this.__loginPasswd, authKey).toString();
			this.__loginName = null;
			this.__loginPasswd = null;
			var jauth = JSON.stringify({login: encLogin, passwd: encPasswd});
			var encJauth = CryptoJS.AES.encrypt(jauth, authKey).toString();
			var url = this.__host ? this._hosts[this.__host]._urlAuthLogin : this._urlAuthLogin;
			var req = new qx.io.remote.Request(url, "GET", "application/json");
			req.addListener("completed", this._authLoginReply, this);
			req.addListener("aborted", this._authReplyAborted, this);
			req.addListener("failed", this._authReplyFailed, this);
			req.addListener("timeout", this._authReplyTimeout, this);
			req.setParameter("jauth", encJauth, false);
			req.send();
		},
		login: function(loginName, passwd, system) {
			var url = this._urlAuthGetKey;
			if ( system ) {
				var host = this.getRootHost(system.getHost());
				if ( host != "" ) {
					url = system.getURL('auth/getKey');
					this._hosts[host] = {
							_urlAuthGetInfo: system.getURL('auth/getInfo'),
							_urlAuthGetKey: url,
							_urlAuthLogin: system.getURL('auth/login')
						};
					this.__host = host;
				}
			}
			var req = new qx.io.remote.Request(url, "GET", "application/json");
			req.addListener("completed", this._authKeyReply, this);
			req.addListener("aborted", this._authReplyFailed, this);
			req.addListener("failed", this._authReplyFailed, this);
			req.addListener("timeout", this._authReplyFailed, this);
			this.__loginName = loginName;
			this.__loginPasswd = passwd;
			req.send();
		},
		setReqAuthToken: function(req) {
			var host = this.getRootHost(req.getUrl());
			if ( host == "" ) {
				req.setRequestHeader('x-zyppmon-auth-token', this.__authToken);
			} else if ( this._hosts[host] && this._hosts[host].__authToken ) {
				req.setRequestHeader('x-zyppmon-auth-token', this._hosts[host].__authToken);
			}
		}
	}
});
