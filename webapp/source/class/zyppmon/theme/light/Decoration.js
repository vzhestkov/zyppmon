/* ************************************************************************

   Copyright:

   License:

   Authors:

************************************************************************ */

qx.Theme.define("zyppmon.theme.light.Decoration", {
	extend : qx.theme.indigo.Decoration,

	decorations: {
		"login-background": {
			decorator: qx.ui.decoration.Decorator,
			style: {
				gradientStart: ["#02a49c", 0],
				gradientEnd: ["#a0ff5f", 100],
				backgroundColor: "login-bg-color"
			}
		},

		"button-box": {
			style: {
				radius: 4,
				width: 1,
				color: "button-border",
				backgroundColor: "button-box"
			}
		},

		"button-box-pressed": {
			include: "button-box",

			style: {
				backgroundColor : "button-box-pressed"
			}
		},

		"button-box-pressed-hovered": {
			include: "button-box-pressed",

			style: {
				color : "button-border-hovered"
			}
		},

		"button-box-hovered": {
			include: "button-box",

			style: {
				color: "button-border-hovered",
				backgroundColor: "button-box-hovered"
			}
		},

		"toolbar-separator": {
			style: {
			}
		},

		"window-caption": {
			style: {
				color: "window-caption-underline",
				backgroundColor: "window-caption-color",
				widthBottom: 3
			}
		}
	}
});
