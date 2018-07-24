qx.Class.define("zyppmon.SettingsWindow", {
	extend : qx.ui.window.Window,
	include : [qx.locale.MTranslation],
	construct : function() {
		this.base(arguments, this.tr("WINDOW_HDR_SETTINGS"));
				
		this.setShowMinimize(false);
		this.setShowMaximize(false);
		this.setAllowMaximize(false);
		this.setResizable(false);
		this.setModal(true);
		this.moveTo(Math.round(qx.bom.Viewport.getWidth()/2-200), 80);

		// add the layout
		var layout = new qx.ui.layout.VBox;
		this.setLayout(layout);

		var form = new qx.ui.form.Form();

		var tabView = new qx.ui.tabview.TabView();
		tabView.setWidth(600);

		var page1 = new qx.ui.tabview.Page(this.tr("SETTINGS_TAB_SOURCES"));
		page1.setLayout(new qx.ui.layout.VBox());
		var bcr = new qx.ui.table.cellrenderer.Boolean();
		var bce = new qx.ui.table.celleditor.CheckBox();
		var sccr = new qx.ui.table.cellrenderer.String("center");
		var tmSystemsColumns = [
				{ id: "usid", label: this.tr("SETTINGS_SRC_TABLE_HDR_USID"),
					visible: false, sortable: false, primaryKey: true },
				{ id: "name", label: this.tr("SETTINGS_SRC_TABLE_HDR_NAME"),
					mandatory: true, visible: true, sortable: false, editable: true, resizeBehaviour: { minWidth:200 } },
				{ id: "type", label: this.tr("SETTINGS_SRC_TABLE_HDR_TYPE"),
					visible: true, sortable: false, resizeBehaviour: { minWidth:60, maxWidth:80 } },
				{ id: "enabled", label: this.tr("SETTINGS_SRC_TABLE_HDR_ENABLED"),
					visible: true, sortable: false, editable: true, resizeBehaviour: { minWidth:50, maxWidth:60 },
				 	cellRenderer: bcr, cellEditor: bce },
				{ id: "sstatus", label: this.tr("SETTINGS_SRC_TABLE_HDR_SSTATUS"),
					visible: true, sortable: false, resizeBehaviour: { minWidth:60, maxWidth:80 }, cellRenderer: sccr },
				{ id: "status", sortable: false, label: this.tr("SETTINGS_SRC_TABLE_HDR_STATUS"),
					visible: false }];
		var table = this.srcTable = new zyppmon.table.ZyppmonTable(tmSystemsColumns);
		var tcm = table.getTableColumnModel();
		table.setColumnVisibilityButtonVisible(false);
		table.setHeight(230);
		table.setStatusBarVisible(false);
		table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
		table.getSelectionModel().addListener("changeSelection", this.changeSrcSelection, this);
		table.setDraggable(true);
		table.setDroppable(true);
		table.addListener("dragstart", this._handleDragStart, this);
		table.addListener("drag", this._handleDrag, this);
		table.addListener("droprequest", this._handleDropRequest, this);
		table.addListener("drop", this._handleDrop, this);
		table.addListener("dragend", this._handleDrop, this);
		page1.add(table);
		var toolbar = new qx.ui.toolbar.ToolBar().set({padding: 0, backgroundColor: "transparent"});
		page1.add(toolbar);
		var snapshotSrcButton = this.snapshotSrcButton = new qx.ui.toolbar.Button(this.tr("SETTINGS_BTN_SRC_SNAPSHOT"), "icon/snapshot22.png");
		snapshotSrcButton.setEnabled(false);
		snapshotSrcButton.addListener("execute", this.snapshotSource, this);
		toolbar.add(snapshotSrcButton);
		var templateButton = this.templateButton = new qx.ui.toolbar.Button(this.tr("SETTINGS_BTN_CR_TEMPLATE"), "icon/template22.png");
		templateButton.setEnabled(false);
		templateButton.addListener("execute", this.createTemplate, this);
		toolbar.add(templateButton);
		toolbar.addSpacer();
		var addSrcButton = new qx.ui.toolbar.Button(this.tr("SETTINGS_BTN_SRC_ADD"), "icon/add22.png");
		addSrcButton.addListener("execute", this.addSource, this);
		toolbar.add(addSrcButton);
		var removeSrcButton = this.removeSrcButton = new qx.ui.toolbar.Button(this.tr("SETTINGS_BTN_SRC_REMOVE"), "icon/delete22.png");
		removeSrcButton.setEnabled(false);
		removeSrcButton.addListener("execute", this.removeSource, this);
		toolbar.add(removeSrcButton);
		tabView.add(page1);

		var page2 = new qx.ui.tabview.Page(this.tr("SETTINGS_TAB_INTERFACE"));
		page2.setLayout(new qx.ui.layout.VBox());
		page2.add(new qx.ui.basic.Label(this.tr("SETTINGS_LBL_LANG")));
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
		if ( langSel ) {
			this.langSelectBox.setSelection([langSel]);
		}
		page2.add(this.langSelectBox);
		var themeLabel = new qx.ui.basic.Label(this.tr("SETTINGS_LBL_THEME"));
		themeLabel.setPaddingTop(8);
		page2.add(themeLabel);
		this.themeSelectBox = new qx.ui.form.SelectBox().set({
			allowGrowY: false,
			alignY: "middle"
		});
		var themeSelections = {"light": this.tr("SETTINGS_THEME_LIGHT"), "dark": this.tr("SETTINGS_THEME_DARK")};
		var theme = qx.module.Cookie.get("theme");
		var themeSel = null;
		for (var key in themeSelections) {
			var item = new qx.ui.form.ListItem(themeSelections[key]);
			item.setUserData("value", key);
			this.themeSelectBox.add(item);
			if ( key == theme ) {
				themeSel = item;
			}
		}
		if ( themeSel ) {
			this.themeSelectBox.setSelection([themeSel]);
		}
		page2.add(this.themeSelectBox);
		tabView.add(page2);

		this.add(tabView);
		this.tabView = tabView;

		var saveButton = new qx.ui.form.Button(this.tr("SETTINGS_BTN_SAVE"));
		saveButton.addListener("execute", this.saveSettings, this);
		form.addButton(saveButton);
		var cancelButton = new qx.ui.form.Button(this.tr("SETTINGS_BTN_CANCEL"));
		cancelButton.addListener("execute", function (e) {
			if ( this.addPopup ) {
				this.addPopup.hide();
			}
			this.close();
		}, this);
		form.addButton(cancelButton);

		this.add(new qx.ui.form.renderer.Single(form));
	},

	members: {
		tabView: null,
		srcTable: null,
		removeSrcButton: null,
		langSelectBox: null,
		themeSelectBox: null,
		addPopup: null,
		_removedSystems: null,
		/**
		* @lint ignoreDeprecated(alert)
		* @lint ignoreDeprecated(confirm)
		*/
		createAddPopup: function(e) {
			var addPopup = new qx.ui.popup.Popup(new qx.ui.layout.VBox());
			addPopup.set({autoHide: false, padding: [10, 10], placeMethod: "widget",
				position: "top-center", width: 450});
			addPopup.placeToWidget(this.srcTable, true);
			addPopup.setOffsetBottom(-194);
			addPopup.addListener("appear", function (e) {
				var sh = this.getSizeHint();
				if ( sh && sh.height ) {
					this.setOffsetBottom(sh.height*(-1));
				}
			}, addPopup);
			var layout = new qx.ui.layout.Grid(8, 8);
			layout.setColumnAlign(0, "right", "top");
			layout.setColumnWidth(0, 100);
			layout.setColumnFlex(1, 1);
			addPopup.setLayout(layout);
			addPopup.srcName = new qx.ui.form.TextField();
			addPopup.srcName.setNativeContextMenu(true);
			addPopup.srcName.setPlaceholder(this.tr("SETTINGS_POPUP_SRC_NAME_PH"));
			var typeGroup = new qx.ui.form.RadioButtonGroup();
			addPopup.rbTypeHost = new qx.ui.form.RadioButton(this.tr("SETTINGS_POPUP_SRC_TYPE_HOST"));
			typeGroup.add(addPopup.rbTypeHost);
			addPopup.rbTypeFile = new qx.ui.form.RadioButton(this.tr("SETTINGS_POPUP_SRC_TYPE_FILE"));
			typeGroup.add(addPopup.rbTypeFile);
			typeGroup.addListener("changeSelection", function (e) {
				this.remove(addPopup.srcLabel);
				if ( this.rbTypeHost.getValue() ) {
					this.srcLabel = new qx.ui.basic.Label(this.tr("SETTINGS_POPUP_SRC_HOST")+":");
					this.srcLabel.set({allowShrinkX: false});
					this.add(this.srcLabel, {row: 3, column: 0});
					this.remove(this.upload);
					this.add(this.srcHost, {row: 3, column: 1});
				} else {
					this.srcLabel = new qx.ui.basic.Label(this.tr("SETTINGS_POPUP_SRC_FILE")+":");
					this.srcLabel.set({allowShrinkX: false});
					this.add(this.srcLabel, {row: 3, column: 0});
					this.remove(this.srcHost);
					this.add(this.upload, {row: 3, column: 1});
				}
			}, addPopup);
			addPopup.srcHost = new qx.ui.form.TextField();
			addPopup.srcHost.setPlaceholder(this.tr("SETTINGS_POPUP_SRC_HOST_PH"));
			addPopup.srcHost.setNativeContextMenu(true);
			addPopup.upload = new zyppmon.upload.UploadForm("uploadForm", "/system/add/file");
			addPopup.upload.setParameter('x-jauth', this.__appRef._authProv.getToken());
			addPopup.upload.addListener('completed', function(e) {
				try {
					var resp = this.addPopup.upload.getIframeTextContent();
					var data = qx.lang.Json.parse(resp);
					var s = new zyppmon.System();
					if ( data.usid ) {
						var tm = this.srcTable.getTableModel();
						for ( var i = tm.getRowCount() - 1; i >= 0 ; i-- ) {
							var dt = tm.getRowDataAsMap(i);
							if ( dt.status == s.statuses.SRC_PENDING && !(dt.usid && dt.usid > "") ) {
								dt.usid = data.usid;
								tm.setRowsAsMapArray(new Array(dt), i, false, false);
							}
						}
					}
					this.addPopup.destroy();
					this.addPopup = null;
				} catch (err) {
					console.log("Error on getting response from server. : "+err);
				}
			}, this);
			addPopup.upload.setLayout(new qx.ui.layout.Grow());
			addPopup.upField = new zyppmon.upload.UploadField("uploadFile", this.tr("SETTINGS_POPUP_SRC_FILE_FIELD"));
			addPopup.upField.getTextField().setPlaceholder(this.tr("SETTINGS_POPUP_SRC_FILE_PH"));
			addPopup.upField.getButton().setIcon("icon/upload22.png");
			addPopup.upField.addListener('changeFileName', function(e) {
				if ( ! this.srcName.getValue() > "" ) {
					var fn = this.upField.getFileName();
					if ( fn.match(/; /) ) {
						this.srcName.setValue(fn);
					} else {
						this.srcName.setValue(fn.replace(/^.*[\\\/]/, "").replace(/\.\w+$/, ""));
					}
				}
			}, addPopup);
			addPopup.upload.add(addPopup.upField);
			var addButton = new qx.ui.form.Button(this.tr("SETTINGS_POPUP_BTN_ADD"));
			addButton.addListener("execute", function (e) {
				var usn = this.addPopup.srcName.getValue();
				var host = this.addPopup.srcHost.getValue();
				usn = usn ? usn.replace(/^\s+/, "").replace(/\s+$/, "") : "";
				host = host ? host.replace(/^\s+/, "").replace(/\s+$/, "") : "";
				if ( usn == "" ) {
					alert(this.tr("SETTINGS_POPUP_ALERT_NO_NAME"));
					return;
				}
				var tm = this.srcTable.getTableModel();
				for ( var i = tm.getRowCount() - 1; i >= 0 ; i-- ) {
					var dt = tm.getRowDataAsMap(i);
					if ( dt.name == usn ) {
						if ( confirm(this.tr("SETTINGS_POPUP_ALERT_NAME_EXISTS")) ) {
							break;
						} else {
							return;
						}
					}
				}
				if ( this.addPopup.rbTypeHost.getValue() ) {
					if ( host == "" ) {
						alert(this.tr("SETTINGS_POPUP_ALERT_NO_HOST"));
						return;
					}
					var req = new qx.io.remote.Request("/system/add/host", "POST", "application/json");
					this.__appRef._authProv.setReqAuthToken(req);
					req.setParameter("usn", usn, false);
					req.setParameter("host", host, false);
					req.addListener('completed', function(e) {
						var data = e.getContent();
					}, this);
					req.send();
				} else {
					this.addPopup.upload.setParameter("usn", usn);
					this.addPopup.upload.send();
				}
				var s = new zyppmon.System();
				this._addSource({name: addPopup.srcName.getValue(), type: this.addPopup.rbTypeHost.getValue() ? "host" : "file",
								enabled: true, status: s.statuses.SRC_PENDING});
				this.addPopup.hide();
				this.setEnabled(true);
			}, this);
			var cancelButton = new qx.ui.form.Button(this.tr("SETTINGS_POPUP_BTN_CANCEL"));
			cancelButton.addListener("execute", function (e) {
				this.addPopup.hide();
				this.setEnabled(true);
				this.addPopup.destroy();
				this.addPopup = null;
			}, this);
			var header = new qx.ui.container.Composite();
			header.setLayout(new qx.ui.layout.HBox(0, "left"));
			header.add(new qx.ui.basic.Label(this.tr("SETTINGS_POPUP_HEADER")).set({font: "bold"}));
			addPopup.add(header, {row: 0, column: 0, colSpan: 2});
			addPopup.add(new qx.ui.basic.Label(this.tr("SETTINGS_POPUP_SRC_NAME")+":").set({allowShrinkX: false}), {row: 1, column: 0});
			addPopup.add(addPopup.srcName, {row: 1, column: 1});
			addPopup.add(new qx.ui.basic.Label(this.tr("SETTINGS_POPUP_SRC_TYPE")+":").set({allowShrinkX: false}), {row: 2, column: 0});
			addPopup.add(typeGroup, {row: 2, column: 1});
			addPopup.srcLabel = new qx.ui.basic.Label(this.tr("SETTINGS_POPUP_SRC_HOST")+":");
			addPopup.srcLabel.set({allowShrinkX: false});
			addPopup.add(addPopup.srcLabel, {row: 3, column: 0});
			addPopup.add(addPopup.srcHost, {row: 3, column: 1});
			var composite = new qx.ui.container.Composite();
			composite.setLayout(new qx.ui.layout.HBox(5, "right"));
			composite.add(addButton);
			composite.add(cancelButton);
			addPopup.add(composite, {row: 4, column: 0, colSpan: 2});
			return addPopup;
		},
		_addSource: function(source_data) {
			var s = new zyppmon.System();
			var tm = this.srcTable.getTableModel();
			source_data.sstatus = s.statuses_labels[source_data.status];
			var dt = tm.getDataAsMapArray();
			tm.setDataAsMapArray(tm.getDataAsMapArray().concat(source_data));
		},
		addSource: function(e) {
			this.addPopup = this.createAddPopup();
			this.addPopup.show();
			this.setEnabled(false);
		},
		snapshotSource: function(e) {
			this.snapshotSrcButton.setEnabled(false);
			var tm = this.srcTable.getTableModel();
			var sm = this.srcTable.getSelectionModel();
			var systems = this.__appRef.systemsList;
			for ( var i = 0; i < tm.getRowCount() ; i++ ) {
				var rd = tm.getRowDataAsMap(i);
				var s = systems.getByUSID(rd.usid);
				if ( sm.isSelectedIndex(i) && s )
					s.createSnapshot();
			}
		},
		createTemplate: function(e) {
			this.templateButton.setEnabled(false);
			var tm = this.srcTable.getTableModel();
			var sm = this.srcTable.getSelectionModel();
			var systems = this.__appRef.systemsList;
			var usids = [];
			for ( var i = 0; i < tm.getRowCount() ; i++ ) {
				var rd = tm.getRowDataAsMap(i);
				var s = systems.getByUSID(rd.usid);
				if ( sm.isSelectedIndex(i) && s )
					usids.push(rd.usid);
			}
			var req = new qx.io.remote.Request("/templates/create", "POST", "application/json");
			this.__appRef._authProv.setReqAuthToken(req);
			req.setParameter("count", usids.length, false);
			for ( var i = 0; i < usids.length ; i++ )
				req.setParameter("usid"+i, usids[i], false);
			req.addListener('completed', function(e) {
				var data = e.getContent();
			}, this);
			req.send();
		},
		clearSystems: function() {
			this.srcTable.clearTable();
		},
		setAppRef: function(app) {
			this.__appRef = app;
			this.setSystems();
		},
		setSystems: function() {
			var systems = this.__appRef.systemsList;
			if ( !systems ) return;
			this.clearSystems();
			systems.forEach(function(s) {
				var el = s.getData();
				this._addSource(el);
			}, this);
			systems.addListener("systemsUpdated", this.updateSystems, this);
			systems.addListener("statusesUpdated", this.updateSystems, this);
			systems.addListener("statesUpdated", this.updateSystems, this);
		},
		updateSystems: function() {
			var tm = this.srcTable.getTableModel();
			var systems = this.__appRef.systemsList;
			var listed = new Array();
			var i;
			for ( i = tm.getRowCount() - 1; i >= 0; i-- ) {
				var dt = tm.getRowDataAsMap(i);
				var s = systems.getByUSID(dt.usid);
				if ( s ) {
					listed.push(dt.usid);
					var d = s.getData();
					var cd = tm.getRowDataAsMap(i);
					d.status = (cd.status != s.statuses.SRC_REMOVED) ? d.status : s.statuses.SRC_REMOVED;
					d.sstatus = s.statuses_labels[d.status];
					tm.setRowsAsMapArray(new Array(d), i, false, false);
				} else {
					tm.removeRows(i, 1, false);
				}
			}
			for ( i = 0; i < systems.length; i++ ) {
				var dt = systems.getItem(i).getData();
				if ( !listed.find(function(el) { return el == dt.usid; }) && !(dt.usid in this._removedSystems) )
					this._addSource(dt);
			}
		},
		removeSource: function(e) {
			var tm = this.srcTable.getTableModel();
			var s = new zyppmon.System();
			var sm = this.srcTable.getSelectionModel();
			for ( var i = 0; i < tm.getRowCount() ; i++ ) {
				var rd = tm.getRowDataAsMap(i);
				if ( sm.isSelectedIndex(i) || (rd.usid == s.statuses.SRC_REMOVED) ) {
					if ( rd.type != "self" ) {
						this._removedSystems[rd.usid] = 1;
					}
				}
			}
			for ( var i = tm.getRowCount() - 1; i >= 0 ; i-- ) {
				var rd = tm.getRowDataAsMap(i);
				if ( rd.usid in this._removedSystems ) {
					tm.removeRows(i, 1, false);
				}
			}
		},
		changeSrcSelection: function(e) {
			var isSelfSelected = false;
			var selCnt = 0;
			var tm = this.srcTable.getTableModel();
			this.srcTable.getSelectionModel().iterateSelection(function(itm) {
				var rd = tm.getRowDataAsMap(itm);
				if ( rd.type === "self" ) {
					isSelfSelected = true;
				}
				selCnt++;
			});
			this.snapshotSrcButton.setEnabled(selCnt > 0);
			this.templateButton.setEnabled(selCnt > 0);
			this.removeSrcButton.setEnabled(!isSelfSelected && selCnt > 0);
		},
		saveSettings: function(e) {
			var tm = this.srcTable.getTableModel();
			var systems = this.__appRef.systemsList;
			for ( var usid in this._removedSystems ) {
				var s = systems.getByUSID(usid);
				if ( s )
					systems.removeSystem(s);
			}
			var sord = [];
			for ( var i = tm.getRowCount() - 1; i >= 0 ; i-- ) {
				var dt = tm.getRowDataAsMap(i);
				var s = systems.getByUSID(dt.usid);
				if ( s ) {
					if ( s.getName() != dt.name ) s.rename(dt.name);
					if ( s.getEnabled() != dt.enabled ) s.setEnabled(dt.enabled);
					sord.push(dt.usid);
				}
			}
			systems.saveStates(sord);
			var lang = this.langSelectBox.getSelection()[0].getUserData("value");
			if ( lang ) {
				qx.locale.Manager.getInstance().setLocale(lang);
				qx.module.Cookie.set("lang", lang, 365);
			}
			var theme = this.themeSelectBox.getSelection()[0].getUserData("value");
			if ( theme ) {
				qx.module.Cookie.set("theme", theme, 365);
			}
			if ( theme == "dark" ) {
				qx.theme.manager.Meta.getInstance().setTheme(zyppmon.theme.Dark);
			} else {
				qx.theme.manager.Meta.getInstance().setTheme(zyppmon.theme.Light);
			}
			if ( this.addPopup ) {
				this.tabView.setEnabled(true);
				this.addPopup.hide();
			}
			this.close();
		},
		open: function() {
			this.base(arguments);
			this._removedSystems = new Object();
			var systems = this.__appRef.systemsList;
			if ( systems ) {
				this.setSystems();
				systems.startChecking();
			}
		},
		close: function() {
			this.base(arguments);
			var systems = this.__appRef.systemsList;
			if ( systems ) systems.stopChecking();
		},
		_handleDragStart: function(e) {
			var focusedRow = this.srcTable.getFocusedRow();
			this._startRow = {maxIndex: focusedRow, minIndex: focusedRow};
			var tm = this.srcTable.getTableModel();
			var sm = this.srcTable.getSelectionModel();
			var systems = this.__appRef.systemsList;
			var tp;
			var drs = [];
			for ( var i = 0; i < tm.getRowCount() ; i++ ) {
				if ( sm.isSelectedIndex(i) ) {
					var rd = tm.getRowDataAsMap(i);
					var s = systems.getByUSID(rd.usid);
					if ( !s ) {
						console.log("drag not found system / "+rd.usid+" - "+rd.name);
						return;
					}
					var pUSID = s.getParentUSID();
					pUSID = (pUSID ? pUSID : 0);
					if ( typeof(tp) == "undefined" ) {
						tp = pUSID;
					} else if ( tp !== pUSID ) {
						return;
					}
					drs.push(i);
				}
			}
			this.srcTable.setFocusCellOnPointerMove(true);
			this.__dropParent = tp;
			this.__dragRows = drs;
			e.addAction("move");
			e.addType("movetransfer");
		},
		_handleDrag: function(e) {
			var toRow = this.srcTable.getFocusedRow();
			var tm = this.srcTable.getTableModel();
			var systems = this.__appRef.systemsList;
			if ( typeof(toRow) != "undefined" ) {
				var rd = tm.getRowDataAsMap(toRow);
				for ( var i = this.__dragRows.length; i >= 0; i-- ) {
					if ( this.__dragRows[i] == toRow ) {
						e.setDropAllowed(false);
						return;
					}
				}
				var s = systems.getByUSID(rd.usid);
				if ( s ) {
					var pUSID = s.getParentUSID();
					pUSID = (pUSID ? pUSID : 0);
					e.setDropAllowed(pUSID == this.__dropParent);
					return;
				}
			}
			e.setDropAllowed(false);
		},
		_handleDropRequest: function(e) {
			var type = e.getCurrentType();
			e.addData(type, this.__dragRows);
		},
		_handleDrop: function(e) {
			var toRow = this.srcTable.getFocusedRow();
			this.srcTable.setFocusCellOnPointerMove(false);
			this.srcTable.resetSelection();
			if ( typeof(toRow) == "undefined" ) return;
			if ( e.supportsType("movetransfer") && this.__dragRows ) {
				var tm = this.srcTable.getTableModel();
				var dtm = [];
				for ( var i = this.__dragRows.length-1; i >= 0; i-- ) {
					var j = this.__dragRows[i];
					if ( j < toRow ) toRow--;
					var rd = tm.getRowDataAsMap(j);
					dtm.push(rd);
					tm.removeRows(j, 1);
				}
				tm.addRowsAsMapArray(dtm, toRow);
				delete this.__dragRows;
			}
		}
	}
});
