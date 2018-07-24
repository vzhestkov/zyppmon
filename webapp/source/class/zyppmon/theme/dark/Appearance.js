/* ************************************************************************

   Copyright:

   License:

   Authors:

************************************************************************ */

qx.Theme.define("zyppmon.theme.dark.Appearance", {
	extend : zyppmon.theme.light.Appearance,

	appearances: {
		"table/column-button": {
			alias: "button",

			style: function(states) {
				return {
					decorator : "table-header-column-button",
					padding : 3,
					icon : "icon/table/select-column-order.png"
				};
			}
		},

		"selectbox/arrow": {
			include : "image",

			style : function(states) {
				return {
					source : "icon/arrows/down.gif",
					paddingRight : 4,
					paddingLeft : 5
				};
			}
		},

		"scrollbar/button": {
			style : function(states) {
				var styles = {};
				styles.padding = 4;

				var icon = "";
				if (states.left) {
					icon = "left";
					styles.marginRight = 2;
				} else if (states.right) {
					icon += "right";
					styles.marginLeft = 2;
				} else if (states.up) {
					icon += "up";
					styles.marginBottom = 2;
				} else {
					icon += "down";
					styles.marginTop = 2;
				}

				styles.icon = "icon/arrows/"+icon+".gif";

				styles.cursor = "pointer";
				styles.decorator = "button-box";
				return styles;
			}
		}
	}
});
