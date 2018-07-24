/* ************************************************************************

   Copyright:

   License:

   Authors:

************************************************************************ */

/**
 * This is the main application class of your custom application "zyppmon"
 *
# * @asset(zyppmon/*)
 */
qx.Class.define("zyppmon.Application", {
	extend : qx.application.Standalone,



	/*
	*****************************************************************************
		MEMBERS
	*****************************************************************************
	*/

	members: {
		events: {
			loginSucceeded: "qx.event.type.Data",
			loginFailed: "qx.event.type.Data"
		},
		/**
		* This method contains the initial application code and gets called 
		* during startup of the application
		* 
		* @lint ignoreDeprecated(alert)
		*/
		packagesWindow: null,
		historyWindow: null,
		dashWindow: null,
		
		__status: 0,

		main: function() {
			// Call super class
			this.base(arguments);

			// Enable logging in debug variant
			if ( qx.core.Environment.get("qx.debug") && 0 ) {
				// support native logging capabilities, e.g. Firebug for Firefox
				qx.log.appender.Native;
				// support additional cross-browser console. Press F7 to toggle visibility
				qx.log.appender.Console;
			}

			var frame = new qx.ui.container.Composite(new qx.ui.layout.Dock());

			var root = new qx.ui.container.Composite(new qx.ui.layout.Canvas()).set({
				minHeight: 400,
				minWidth: 700
			});
			this.___root = root;

			frame.add(root);

			qx.application.Standalone.prototype.getRoot.call(this).add(frame, {edge:0});
			
			var lang = qx.module.Cookie.get("lang");
			if ( lang ) {
				qx.locale.Manager.getInstance().setLocale(lang);
			}

			var theme = qx.module.Cookie.get("theme");
			if ( theme == "dark" ) {
				qx.theme.manager.Meta.getInstance().setTheme(zyppmon.theme.Dark);
			}

			this.createAuthProv();
		},
		createAuthProv: function() {
			this._authProv = new zyppmon.AuthProvider();
			this._authProv.addListener("loginSucceeded", function (e) {
						this.showMain();
					}, this);
			this._authProv.addListener("loginRequired", function (e) {
						this._authProv.loginRequired = true;
						this.showLogin();
					}, this);
		},
		showLogin: function() {
			if ( this.__layout ) {
				this.__layout = null;
			}
			var root = this.___root;
			root.removeAll();
			var layout = new qx.ui.layout.Grow;
			root.setLayout(layout);
			this.__layout = layout;

			var windowManager = new qx.ui.window.Manager();
			var loginWidget = new qx.ui.window.Desktop(windowManager);
			loginWidget.set({decorator: "login-background"});
			root.add(loginWidget);
			this.loginWindow = new zyppmon.LoginWindow(this._authProv);
			loginWidget.add(this.loginWindow);
			this.loginWindow.open();
		},
		showMain: function() {
			if ( this.__layout ) {
				this.__layout = null;
			}
			var root = this.___root;
			root.removeAll();
			var layout = new qx.ui.layout.Grow;
			root.setLayout(layout);
			this.__layout = layout;

			var splitpane = new qx.ui.splitpane.Pane("vertical");
			var hsplitpane = new qx.ui.splitpane.Pane("horizontal");

			var windowManager = new qx.ui.window.Manager();
			var packagesWidget = new qx.ui.window.Desktop(windowManager);
			hsplitpane.add(packagesWidget, 5);

			this.systemsList = new zyppmon.SystemsList(null, null, this._authProv);
			this.systemsList.addListener("changeActive", function(e) {
				var sys = e.getData();
				if ( sys ) {
					if ( this.dashWindow ) this.dashWindow.loadSystem(sys);
					if ( this.packagesWindow ) this.packagesWindow.loadSystem(sys);
					if ( this.historyWindow ) this.historyWindow.loadSystem(sys);
				}
			}, this);

			this.packagesWindow = new zyppmon.PackagesWindow();
			packagesWidget.add(this.packagesWindow);
			this.packagesWindow.setAppInstance(this);
			this.packagesWindow.open();

			windowManager = new qx.ui.window.Manager();
			var historyWidget = new qx.ui.window.Desktop(windowManager);
			splitpane.add(hsplitpane, 1);
			splitpane.add(historyWidget, 1);

			this.historyWindow = new zyppmon.HistoryWindow();
			historyWidget.add(this.historyWindow);
			this.historyWindow.setAppInstance(this);
			this.historyWindow.open();

			windowManager = new qx.ui.window.Manager();
			var dashWidget = new qx.ui.window.Desktop(windowManager);
			dashWidget.setMinWidth(260);
			dashWidget.setMaxWidth(420);
			hsplitpane.add(dashWidget, 1);

			this.dashWindow = new zyppmon.DashWindow(this);
			dashWidget.add(this.dashWindow);
			this.dashWindow.open();
			this.packagesWindow.setHistoryWindow(this.historyWindow);
			
			root.add(splitpane);
		},
		logout: function() {
			this.systemsList.destroy();
			delete this.systemsList;
			delete this._authProv;
			this.createAuthProv();
		},
		showSettings: function(e) {
			if ( !this.settingsWindow ) {
				this.settingsWindow = new zyppmon.SettingsWindow();
				this.settingsWindow.setAppRef(this);
			}
			this.settingsWindow.open();
		}
	}
});
