/* ************************************************************************

   Copyright:

   License:

   Authors:

************************************************************************ */

qx.Theme.define("zyppmon.theme.light.Appearance", {
	extend : qx.theme.indigo.Appearance,

	appearances: {
		"window": {
			style: function(states) {
				return {
					contentPadding: [ 10, 10, 10, 10 ],
					backgroundColor: "window-background",
					decorator: states.maximized ? undefined : states.active ? "window-active" : "window"
				};
			}
		},

		"window/captionbar": {
			style: function(states) {
				var active = states.active && !states.disabled;
				return {
					padding: [3, 8, active ? 1 : 3, 8],
					textColor: "window-caption-text",
					decorator: "window-caption"
				};
			}
		},

		"window/title": {
			style: function(states) {
				return {
					cursor: "default",
					font: "bold",
					marginRight: 20,
					alignY: "middle"
				};
			}
		},

		"toolbar": {
			style: function(states) {
				return {
					backgroundColor: "toolbar-background",
					padding: [4, 0]
				};
			}
		},

		"toolbar-separator": {
			style : function(states) {
				return {
					decorator: "toolbar-separator",
					margin: [7, 0],
					width: 8
				};
			}
		},

		"toolbar-button": {
			alias: "atom",

			style: function(states) {
				var decorator = "button-box";

				if (states.disabled) {
					decorator = "button-box";
				} else if (states.hovered && !states.pressed && !states.checked) {
					decorator = "button-box-hovered";
				} else if (states.hovered && (states.pressed || states.checked)) {
					decorator = "button-box-pressed-hovered";
				} else if (states.pressed || states.checked) {
					decorator = "button-box-pressed";
				}

				// set the right left and right decoratos
				if (states.left) {
					decorator += "-left";
				} else if (states.right) {
					decorator += "-right";
				} else if (states.middle) {
					decorator += "-middle";
				}

				// set the margin
				var margin = [7, 10];
				if (states.left || states.middle || states.right) {
					margin = [7, 0];
				}

				return {
					cursor: states.disabled ? undefined : "pointer",
					decorator: decorator,
					margin: margin,
					padding: [3, 12]
				};
			}
		},

		"textfield": {
			style: function(states) {
				var textColor;
				if (states.disabled) {
					textColor = "text-disabled";
				} else if (states.showingPlaceholder) {
					textColor = "text-placeholder";
				} else {
					textColor = undefined;
				}

				var decorator;
				var padding;
				if (states.disabled) {
					decorator = "inset";
					padding = [2, 3];
				} else if (states.invalid) {
					decorator = "border-invalid";
					padding = [1, 2];
				} else if (states.focused) {
					decorator = "focused-inset";
					padding = [1, 2];
				} else {
					padding = [2, 3];
					decorator = "inset";
				}

				return {
					decorator: decorator,
					padding: padding,
					textColor: textColor,
					backgroundColor: states.disabled ? "background-disabled" : "textfield-background"
				};
			}
		},

		"tabview-page/button" : {
			style: function(states) {
				var decorator;

				// default padding
				if (states.barTop || states.barBottom) {
					var padding = [4, 16, 4, 13];
				} else {
					var padding = [4, 4, 4, 4];
				}

				// decorator
				if (states.checked) {
					if (states.barTop) {
						decorator = "tabview-page-button-top";
					} else if (states.barBottom) {
						decorator = "tabview-page-button-bottom"
					} else if (states.barRight) {
						decorator = "tabview-page-button-right";
					} else if (states.barLeft) {
						decorator = "tabview-page-button-left";
					}
				} else {
					for (var i=0; i < padding.length; i++) {
						padding[i] += 1;
					}
					// reduce the size by 1 because we have different decorator border width
					if (states.barTop) {
						padding[2] -= 1;
					} else if (states.barBottom) {
						padding[0] -= 1;
					} else if (states.barRight) {
						padding[3] -= 1;
					} else if (states.barLeft) {
						padding[1] -= 1;
					}
				}

				return {
					zIndex: states.checked ? 10 : 5,
					decorator: decorator,
					font: states.checked ? "bold" : undefined,
					textColor: states.disabled ? "text-disabled" : states.checked ? "tabview-tab-label-selected" : "tabview-tab-label-notselected",
					padding: padding,
					cursor: "pointer"
				};
			}
		}
	}
});
