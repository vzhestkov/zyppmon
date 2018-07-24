qx.Class.define("zyppmon.ChartWindow", {
	extend : qx.ui.window.Window,
	include : [qx.locale.MTranslation],
	construct : function() {
		this.base(arguments, this.tr("WINDOW_HDR_HISTORY_CHART"));
		
		this.setShowMinimize(false);
		this.setResizable(true);
		this.setModal(true);
		this.setWidth(1000);
		this.setHeight(480);

		var layout = new qx.ui.layout.Grow;
		this.setLayout(layout);
		this.setContentPadding(0);
		this._canvas = new qx.ui.embed.Canvas().set({
			syncDimension: true
		});
		var splitpane = new qx.ui.splitpane.Pane("vertical");

		var ncr = new qx.ui.table.cellrenderer.Number();
		var chartTblColumns = [
				{ id: "date", label: this.tr("CHART_TBL_HDR_DATE"),
					mandatory: true, visible: true, resizeBehaviour: { minWidth:180 } },
				{ id: "in", label: this.tr("CHART_TBL_HDR_INSTALLS"),
					visible: true, resizeBehaviour: { minWidth:100, maxWidth:130 }, cellRenderer: ncr },
				{ id: "up", label: this.tr("CHART_TBL_HDR_UPDATES"),
					visible: true, resizeBehaviour: { minWidth:100, maxWidth:130 }, cellRenderer: ncr },
				{ id: "dn", label: this.tr("CHART_TBL_HDR_DOWNGRADES"),
					visible: true, resizeBehaviour: { minWidth:100, maxWidth:130 }, cellRenderer: ncr },
				{ id: "rf", label: this.tr("CHART_TBL_HDR_REFRESHES"),
					visible: true, resizeBehaviour: { minWidth:100, maxWidth:130 }, cellRenderer: ncr },
				{ id: "rm", label: this.tr("CHART_TBL_HDR_REMOVES"),
					visible: true, resizeBehaviour: { minWidth:100, maxWidth:130 }, cellRenderer: ncr },
				{ id: "total", label: this.tr("CHART_TBL_HDR_TOTAL"),
					visible: true, resizeBehaviour: { minWidth:100, maxWidth:130 }, cellRenderer: ncr }
			];
		this._table = new zyppmon.table.ZyppmonTable(chartTblColumns);
		this._table.getSelectionModel().setSelectionMode(qx.ui.table.selection.Model.MULTIPLE_INTERVAL_SELECTION);
		var frame = new qx.ui.container.Composite(new qx.ui.layout.Grow());
		frame.add(this._canvas);
		splitpane.add(frame, 3);
		splitpane.add(this._table, 1);
		this.add(splitpane);

		this.moveTo(Math.round((qx.bom.Viewport.getWidth()-this.getWidth())/2), 80);

		this.addListener("close", function (e) {
			this.destroy();
		}, this);

	},

	members: {
		/**
		* @ignore(Chart)
		**/
		showChart: function(system, table) {
			this.setCaption(this.tr("WINDOW_HDR_HISTORY_CHART")+" - "+system.getName());
			this.open();
			var tm = table.getTableModel();
			var dt = {"in": [], "up": [], "dn": [], "rm": [], "rf": []};
			var dtm = {"in": [], "up": [], "dn": [], "rm": [], "rf": []};
			var ndt = {"in": [], "up": [], "dn": [], "rm": [], "rf": []};
			var ndtm = {"in": [], "up": [], "dn": [], "rm": [], "rf": []};
			var df = new qx.util.format.DateFormat('yyyy-MM-dd');
			var dfm = new qx.util.format.DateFormat('yyyy-MM');
			var tmin;
			var tmax;
			for ( var i = 0; i < tm.getRowCount(); i++ ) {
				var rd = tm.getRowDataAsMap(i);
				if ( !tmin || rd.time < tmin ) tmin = rd.time;
				if ( !tmax || rd.time > tmax ) tmax = rd.time;
				var t = df.format(rd.time);
				var mt = dfm.format(rd.time);
				ndt[rd.op][t] = (t in ndt[rd.op]) ? ndt[rd.op][t]+1 : 1;
				ndtm[rd.op][mt] = (mt in ndtm[rd.op]) ? ndtm[rd.op][mt]+1 : 1;
			}
			var dayms = 86400000;
			var tstp = tmax.getTime() + dayms;
			var otm = this._table.getTableModel();
			var otbl = [];
			var ldays = Math.ceil((tmax.getTime()-tmin.getTime())/dayms);
			var showmt = ldays > 365;
			var mtbl = [];
			for ( var i = tmin.getTime(); i < tstp; i += dayms ) {
				var t = df.format(new Date(i));
				var mt = dfm.format(new Date(i));
				var orow = {date: t};
				var tc = 0;
				for ( var op in ndt ) {
					var c = (t in ndt[op]) ? ndt[op][t] : 0;
					dt[op].push({x: t, y: c});
					orow[op] = c;
					tc += c;
				}
				if ( showmt && mtbl.indexOf(mt) == -1 ) {
					for ( var op in ndtm ) {
						dtm[op].push({x: mt, y: (mt in ndtm[op]) ? ndtm[op][mt] : 0});
						mtbl.push(mt);
					}
				}
				orow.total = tc;
				if ( tc ) otbl.push(orow);
			}
			otm.setDataAsMapArray(otbl);
			var parser = "YYYY-MM-DD";
			if ( showmt ) {
				dt = dtm;
				parser = "YYYY-MM";
				tmin = new Date(tmin.getTime() - 30*dayms);
				tmax = new Date(tmax.getTime() + 30*dayms);
				tmin = dfm.format(tmin);
				tmax = dfm.format(tmax);
			} else {
				tmin = new Date(tmin.getTime() - dayms);
				tmax = new Date(tmax.getTime() + dayms);
				tmin = df.format(tmin);
				tmax = df.format(tmax);
			}
			var ctx = this._canvas.getContentElement().getCanvas();
			var myChart = new Chart(ctx, {
				type: 'bar',
				data: {
					datasets: [{
						label: this.tr("CHART_LABEL_INSTALLS"),
						data: dt["in"],
						stack: "dt",
						backgroundColor: 'rgba(54, 162, 235, 1)',
						borderColor: 'rgba(54, 162, 235, 1)',
						borderWidth: 1
					},{
						label: this.tr("CHART_LABEL_UPDATES"),
						data: dt["up"],
						stack: "dt",
						backgroundColor: 'rgba(0, 205, 0, 1)',
						borderColor: 'rgba(0, 205, 0, 1)',
						borderWidth: 1
					},{
						label: this.tr("CHART_LABEL_DOWNGRADES"),
						data: dt["dn"],
						stack: "dt",
						backgroundColor: 'rgba(255, 159, 64, 1)',
						borderColor: 'rgba(255, 159, 64, 1)',
						borderWidth: 1
					},{
						label: this.tr("CHART_LABEL_REMOVES"),
						data: dt["rm"],
						stack: "dt",
						backgroundColor: 'rgba(255, 99, 132, 1)',
						borderColor: 'rgba(255, 99, 132,1)',
						borderWidth: 1
					},{
						label: this.tr("CHART_LABEL_REFRESHES"),
						data: dt["rf"],
						stack: "dt",
						backgroundColor: 'rgba(153, 102, 255, 1)',
						borderColor: 'rgba(153, 102, 255,1)',
						borderWidth: 1
					}]
				},
				options: {
					tooltips: {
						mode: "index",
						position: "nearest",
						intersect: false
					},
					responsive: true,
					responsiveAnimationDuration: 0,
					maintainAspectRatio: false,
					scales: {
						xAxes: [{
							type: "time",
							distribution: "linear",
							bounds: "data",
							stacked: true,
							gridLines: {
								offsetGridLines: true
							},
							time: {
								isoWeekday: true,
								parser: parser,
								min: tmin,
								max: tmax,
								minUnit: "day",
								displayFormats: {
									day: "YYYY-MM-DD",
									week: "YYYY-MM-DD",
									month: "YYYY-MM",
									quarter: "YYYY-[Q]Q",
									year: "YYYY"
								}
							}
						}],
						yAxes: [{
							scaleLabel: {
								display: true,
								labelString: this.tr("CHART_LABEL_YSCALE").toString()
							},
							ticks: {
								beginAtZero: true,
								stepSize: 500,
								min: 0
							},
							stacked: true
						}]
					}
				}
			});
		}
	}
});
