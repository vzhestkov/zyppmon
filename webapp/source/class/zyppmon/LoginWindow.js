qx.Class.define("zyppmon.LoginWindow", {
	extend : qx.ui.window.Window,
	include : [qx.locale.MTranslation],
	construct : function(authProv, external, system) {
		this.base(arguments, this.tr("WINDOW_HDR_LOGIN")+((external && system) ? ": "+system.getName() : ""));
		this._errors = {
				AUTH_ERROR: this.tr("ZYPPMON_ERR_AUTH_ERROR")
			};
		this._authProv = authProv;
		this._external = external ? true : false;
		this._system = system;
		if ( !this._external )
			this.setShowClose(false);
		this.setShowMinimize(false);
		this.setShowMaximize(false);
		this.setAllowMaximize(false);
		this.setResizable(false);
		this.setModal(true);
		this.set({contentPaddingLeft: 20, contentPaddingRight: 20});
		var w = 420;
		this.setWidth(w);
		this.moveTo(Math.round((qx.bom.Viewport.getWidth()-w)/2), 100);

		var layout = new qx.ui.layout.Grid(12, 12);
		layout.setColumnFlex(1, 1);
		layout.setColumnAlign(0, "right", "middle");
		layout.setRowAlign(4, "right", "middle");
		this.setLayout(layout);

		this.add(new qx.ui.basic.Label(this.tr("LOGIN_FORM_NAME")), {row: 0, column: 0});
		this.loginName = new qx.ui.form.TextField();
		var lastLogin = qx.module.Cookie.get("loginName"+(this._system ? "@"+this._system.getUSID() : ""));
		this.loginName.setValue(lastLogin);
		this.loginName.addListener("keypress", function(e) {
			if ( e.getKeyIdentifier().toLowerCase() == "enter" && this.loginName.getValue() > "" ) {
				this.loginPasswd.focus();
			}
		}, this);
		this.add(this.loginName, {row: 0, column: 1});
		this.add(new qx.ui.basic.Label(this.tr("LOGIN_FORM_PASSWORD")), {row: 1, column: 0});
		this.loginPasswd = new qx.ui.form.PasswordField();
		this.loginPasswd.addListener("keypress", function(e) {
			if ( e.getKeyIdentifier().toLowerCase() == "enter" ) {
				this.tryLogin(e);
			}
		}, this);
		this.add(this.loginPasswd, {row: 1, column: 1});

		if ( this._external ) {
			this.add(new qx.ui.basic.Label(this.tr("LOGIN_FORM_SYSTEM")), {row: 2, column: 0});
			this.add(new qx.ui.basic.Label(system.getName()), {row: 2, column: 1});
		} else {
			this.add(new qx.ui.basic.Label(this.tr("LOGIN_FORM_LANG")), {row: 2, column: 0});
			this.langSelectBox = new qx.ui.form.SelectBox().set({
				allowGrowY: false,
				alignY: "middle"
			});
			var langSelections = {"en": this.tr("LANG_EN"), "ru": this.tr("LANG_RU")};
			var lang = qx.module.Cookie.get("lang");
			var langSel = null;
			for (var key in langSelections) {
				var item = new qx.ui.form.ListItem(langSelections[key]);
				item.setUserData("value", key);
				this.langSelectBox.add(item);
				if ( key == lang ) {
					langSel = item;
				}
			}
			this.langSelectBox.addListener("changeSelection", function(e) {
				var lang = this.langSelectBox.getSelection()[0].getUserData("value");
				if ( lang ) {
					qx.locale.Manager.getInstance().setLocale(lang);
					qx.module.Cookie.set("lang", lang, 365);
				}
			}, this);
			if ( langSel ) {
				this.langSelectBox.setSelection([langSel]);
			}
			this.add(this.langSelectBox, {row: 2, column: 1});
		}

		var buttons = new qx.ui.container.Composite(new qx.ui.layout.HBox().set({spacing: 10, alignX: "right"}));
		this._loginButton = new qx.ui.form.Button(this.tr("LOGIN_FORM_BTN_LOGIN"));
		this._loginButton.set({minWidth: 100, maxWidth: 130});
		this._loginButton.addListener("execute", this.tryLogin, this);
		buttons.add(this._loginButton);
		if ( this._system ) {
			this._cancelButton = new qx.ui.form.Button(this.tr("LOGIN_FORM_BTN_CANCEL"));
			this._cancelButton.set({minWidth: 100, maxWidth: 130});
			this._cancelButton.addListener("execute", function (e) {
						this.close();
						this.destroy();
					}, this);
			buttons.add(this._cancelButton);
			this.addListener("keypress", function (e) {
						if ( e.getKeyIdentifier().toLowerCase() == "escape" ) {
							this.close();
							this.destroy();
						}
					}, this);
		}
		this.add(buttons, {row: 4, column: 0, colSpan: 2});
		this._authProv.addListener("loginFailed", this._showLoginFail, this);
		if ( this._system ) this._authProv.addListener("loginSucceeded", function (e) {
					this.close();
					this.destroy();
				}, this);
		this.addListener("appear", function(e) {
				var ln = this.loginName.getValue();
				if ( this.loginName.getValue() > "" ) {
					this.loginPasswd.focus();
				} else {
					this.loginName.focus();
				}
			}, this);
	},

	members: {
		_errors: null,
		_errLabel: null,
		_external: false,
		_system: null,
		tryLogin: function(e) {
			this._loginButton.setEnabled(false);
			var loginName = this.loginName.getValue();
			var loginPasswd = this.loginPasswd.getValue();
			qx.module.Cookie.set("loginName"+(this._system ? "@"+this._system.getUSID() : ""), loginName, 365);
			if ( this._errLabel ) {
				this._errLabel.hide();
			}
			this._authProv.login(loginName, loginPasswd);
		},
		_showLoginFail: function(e) {
			var data = e.getData();
			console.log("Login FAILED: "+JSON.stringify(data));
			var msg = data.msg;
			if ( data.error in this._errors )
				msg = this._errors[data.error];
			if ( this._errLabel ) {
				this._errLabel.setValue(msg);
				this._errLabel.show();
			} else {
				this._errLabel = new qx.ui.basic.Label(msg).set(
						{backgroundColor: "red",
						 textColor: "white",
						 font: "bold",
						 allowGrowX: true,
						 textAlign: "right",
						 paddingLeft: 10, paddingRight: 10,
						 paddingTop: 2, paddingBottom: 2});
				this.add(this._errLabel, {row: 3, column: 0, colSpan: 2});
			}
			this.loginPasswd.setValue("");
			this.loginPasswd.focus();
			this._loginButton.setEnabled(true);
		}
	}
});
