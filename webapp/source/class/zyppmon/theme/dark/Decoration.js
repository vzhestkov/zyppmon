/* ************************************************************************

   Copyright:

   License:

   Authors:

************************************************************************ */

qx.Theme.define("zyppmon.theme.dark.Decoration", {
	extend: zyppmon.theme.light.Decoration,

	decorations: {
		"inset": {
			style: {
				width : 1,
				color : [ "textfield-border" ]
			}
		},
		"selectbox-list": {
			style: {
				backgroundColor: "button-box"
			}
		}
	}
});
