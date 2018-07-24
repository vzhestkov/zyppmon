qx.Class.define("zyppmon.table.ZyppmonTable", {
	extend : qx.ui.table.Table,
	include: [qx.locale.MTranslation],
	
	construct: function(dataModel) {
		this.__dataModel = dataModel;
		this.base(arguments, null, {
				tableColumnModel : function(obj) {
					return new qx.ui.table.columnmodel.Resize(obj);
				}
			});
		var hdrLabels = [];
		var hdrNames = [];
		for ( var i = 0; i < dataModel.length; i++ ) {
			hdrLabels.push(dataModel[i].label);
			hdrNames.push(dataModel[i].id);
		}
		var tableModel = new qx.ui.table.model.Filtered();
		tableModel.setColumns(hdrLabels, hdrNames);
		this.setTableModel(tableModel);
		var tcm = this.getTableColumnModel();
		var resizeBehavior = tcm.getBehavior();
		for ( var i = 0; i < dataModel.length; i++ ) {
			if ( dataModel[i].primaryKey && this.__primaryKey == null )
				this.__primaryKey = i;
			if ( dataModel[i].visible === false )
				tcm.setColumnVisible(i,false);
			if ( dataModel[i].editable === true )
				tableModel.setColumnEditable(i, true);
			if ( dataModel[i].sortable === true || dataModel[i].sortable === false )
				tableModel.setColumnSortable(i, dataModel[i].sortable);
			if ( dataModel[i].cellRenderer )
				tcm.setDataCellRenderer(i, dataModel[i].cellRenderer);
			if ( dataModel[i].cellEditor )
				tcm.setCellEditorFactory(i, dataModel[i].cellEditor);
			if ( dataModel[i].resizeBehaviour )
				resizeBehavior.set(i, dataModel[i].resizeBehaviour);
			if ( dataModel[i].width )
				resizeBehavior.setWidth(i, dataModel[i].width);
		}
		
		var cmenu = new qx.ui.menu.Menu();
		var copyValue = new qx.ui.menu.Button(this.tr("ZMTABLE_CMENU_COPY_VALUE"));
		copyValue.addListener("execute", this._copyValue, this);
		var copyRows = new qx.ui.menu.Button(this.tr("ZMTABLE_CMENU_COPY_ROWS"));
		copyRows.addListener("execute", this._copyRows, this);
		cmenu.add(copyValue);
		cmenu.add(copyRows);
		this.setContextMenu(cmenu);
		
		this.addListener("cellContextmenu", function(e) {
				this._lastCellEvent = e;
			}, this);
	},

	members: {
		__primaryKey: null,
		__system: null,
		/*
		 * Updates the text shown in the status bar.
		 */
		_updateStatusBar: function() {
			var tableModel = this.getTableModel();

			if (this.getStatusBarVisible()) {
				var selectedRowCount = this.getSelectionModel().getSelectedCount();
				var rowCount = tableModel.__rowArr.length;

				var text;
				
				var fullRowCount = tableModel.__fullArr ? tableModel.__fullArr.length : rowCount;
				
				if ( fullRowCount == rowCount ) {
					text = this.tr("ZMTABLE_STATUS_%1_%2", rowCount, selectedRowCount);
				} else {
					text = this.tr("ZMTABLE_STATUS_FILTERED_%1_%2_%3", fullRowCount, rowCount, selectedRowCount);
				}

				if (this.__additionalStatusBarText)
					text = (text ? text : "") + this.__additionalStatusBarText;

				if ( text )
					this.getChildControl("statusbar").setValue(text);
			}
		},
		_loadData: function(next) {
			var req = new qx.io.remote.Request(this._url, "GET", "application/json");
			req.setTimeout(8000);
			if ( this.__system )
				this.__system.setReqAuthToken(req);
			req.setParameter("token", this.__token, false);
			if ( next )
				req.setParameter("next", next, false);
			req.addListener("completed", this._onReqComplete, this);
			req.send();
		},
		_onReqComplete: function(e) {
			var dt = e.getContent();
			var data = dt.data;
			if ( !(dt.ctrl && dt.ctrl.token && dt.ctrl.token == this.__token) ) {
				return;
			}
			if ( !Array.isArray(data) ) {
				return;
			}
			var size = dt.ctrl.size ? dt.ctrl.size : 0;
			var next = dt.ctrl.next ? dt.ctrl.next : 0;
			var start = dt.ctrl.start ? dt.ctrl.start : 0;
			var pf = this._parseFunc;
			if ( pf && (typeof pf) == "function" )
				data.forEach(function(el, idx) {
					pf(el, idx);
				});
			if ( this._parseDataFunc && (typeof this._parseDataFunc) == "function" ) {
				var pdf = this._parseDataFunc.bind(this._parseDataCtx);
				pdf(data);
			}
			var tm = this.getTableModel();
			this.__ld = this.__ld.concat(data);
			if ( next == 0 ) {
				var c = this.__ld.length;
				var t = Math.ceil(c / 10);
				var dm = this.__dataModel;
				for ( var i = 0; i < t; i++ ) {
					var ti = Math.floor(Math.random() * c);
					for ( var k in dm )
						if ( dm[k].id in this.__ld[ti] )
							dm[k].c = dm[k].c ? dm[k].c+1 : 1;
				}
				var tcm = this.getTableColumnModel();
				for ( var k in dm ) {
					tcm.setColumnVisible(parseInt(k),("mandatory" in dm[k]) ||
							(("visible" in dm[k]) && dm[k].visible && (("c" in dm[k]) && (dm[k].c > 0))));
					dm[k].c = 0;
				}
				tm.setDataAsMapArray(this.__ld);
				this.__ld = [];
				if ( this._finalFunc && (typeof this._finalFunc) == "function" ) {
					var ff = this._finalFunc.bind(this._finalFuncCtx);
					ff();
				}
			} else {
				this.getChildControl("statusbar").setValue(
					this.tr("ZMTABLE_LOADING_%1_%2_%3", this.__ld.length, size, Math.round((this.__ld.length/size)*100)+"%"));
				this._loadData(next);
			}
		},
		clearTable: function () {
			var tm = this.getTableModel();
			tm.resetHiddenRows();
			tm.setData(Array());
			var sm = this.getSelectionModel();
			sm.resetSelection();
		},
		setSourceURL: function(url) {
			this._url = url;
		},
		setParseFunc: function(func) {
			this._parseFunc = func;
		},
		setParseDataFunc: function(func, ctx) {
			this._parseDataFunc = func;
			this._parseDataCtx = ctx;
		},
		setFinalFunc: function(func, ctx) {
			this._finalFunc = func;
			this._finalFuncCtx = ctx;
		},
		loadData: function(system) {
			if ( system )
				this.__system = system;
			this.__ld = [];
			var token = "";
			var s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
			for (var i = 0; i < 64; i++)
				token += s.charAt(Math.floor(Math.random() * s.length));
			this.__token = token;
			this.clearTable();
			this._loadData();
		},
		copyToClipboard: function(text) {
			var ta = new qx.ui.form.TextArea(text);
			this._add(ta);
			ta.setHeight(0);
			ta.setNativeContextMenu(true);
			ta.selectAllText();
			ta.show();
			ta.addListener("appear", function() { 
				ta.focus();
				var el = ta.getContentElement().getDomElement();
				el.select();
				document.execCommand("cut");
				this._remove(ta);
				ta.destroy();
			}, this);
		},
		_copyValue: function(e) {
			if ( this._lastCellEvent ) {
				var vl = this.getTableModel().getValue(this._lastCellEvent.getColumn(), this._lastCellEvent.getRow());
				if ( vl instanceof Date ) {
					var df = new qx.util.format.DateFormat('yyyy-MM-dd HH:mm:ss');
					vl = df.format(vl);
				}
				this.copyToClipboard(vl);
				this._lastCellEvent = null;
			}
		},
		_copyRows: function(e) {
			var tcm = this.getTableColumnModel();
			var vc = tcm.getVisibleColumns();
			var sm = this.getSelectionModel();
			var tm = this.getTableModel();
			var df = new qx.util.format.DateFormat('yyyy-MM-dd HH:mm:ss');
			var fvl = "";
			for ( var i = 0; i < vc.length; i++ ) {
				var vl = tm.getColumnName(vc[i]);
				fvl += (i == 0 ? "" : "\t") + vl;
			}
			fvl += "\n";
			sm.iterateSelection(function(idx) {
					var s = "";
					for ( var i = 0; i < vc.length; i++ ) {
						var vl = tm.getValue(vc[i], idx);
						if ( typeof(vl) === 'undefined' ) vl = "";
						s += (i == 0 ? "" : "\t") + (vl instanceof Date ? df.format(vl) : vl);
					}
					fvl += s+"\n";
				});
			this.copyToClipboard(fvl);
		}
	}
});
