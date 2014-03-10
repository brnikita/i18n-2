/**
 * @author  John Resig <jeresig@gmail.com>
 * @author  Originally by Marcus Spiegel <marcus.spiegel@gmail.com>
 * @link    https://github.com/jeresig/i18n-node
 * @license http://opensource.org/licenses/MIT
 *
 * @version 0.4.5
 */

// dependencies
var vsprintf = require("sprintf").vsprintf,
	fs = require("fs"),
	path = require("path");

var i18n = module.exports = function(opt) {
	var self = this;

	// Put into dev or production mode
	this.devMode = process.env.NODE_ENV !== "production";

	// Copy over options
	for (var prop in opt) {
		this[prop] = opt[prop];
	}

	// you may register helpers in global scope, up to you
	if (typeof this.register === "object") {
		i18n.registerMethods.forEach(function(method) {
			self.register[method] = self[method].bind(self);
		});
	}

	// implicitly read all locales
	// if it's an array of locale names, read in the data
	if (opt.locales && opt.locales.forEach) {
		this.locales = {};

		opt.locales.forEach(function(locale) {
			self.readFile(locale);
		});

        if(typeof this.defaultLocale === 'undefined'){
		    this.defaultLocale = opt.locales[0];
        }
	}

	// Set the locale to the default locale
	this.setLocale(this.defaultLocale);

	// Check the defaultLocale
	if (!this.locales[this.defaultLocale]) {
		console.error("Not a valid default locale.");
	}

	if (this.request) {
        this.setLocaleFromQueryOrCookie(this.request, this.response);
		this.prefLocale = this.preferredLocale();
	}
};

i18n.version = "0.4.5";

i18n.localeCache = {};
i18n.resMethods = ["__", "__n", "getLocale", "isPreferredLocale"];

i18n.expressBind = function(app, opt) {
	if (!app) {
		return;
	}

	app.use(function(req, res, next) {
		opt.request = req;
		opt.response = res;
        req.i18n = new i18n(opt);

		// Express 3
		if (res.locals) {
			i18n.registerMethods(res.locals, req)
		}

		next();
	});
};

i18n.registerMethods = function(helpers, req) {
	i18n.resMethods.forEach(function(method) {
		if (req) {
			helpers[method]	= req.i18n[method].bind(req.i18n);
		} else {
			helpers[method] = function(req) {
				return req.i18n[method].bind(req.i18n);
			};	
		}
		
	});

	return helpers;
};

i18n.prototype = {
	defaultLocale: "en",
	extension: ".js",
	directory: "./locales",
	cookiename: "locale",

	__: function() {
		var msg = this.translate(this.locale, arguments[0]);

		if (arguments.length > 1) {
			msg = vsprintf(msg, Array.prototype.slice.call(arguments, 1));
		}

		return msg;
	},

	__n: function(singular, plural, count) {
		var msg = this.translate(this.locale, singular, plural);

		msg = vsprintf(parseInt(count, 10) > 1 ? msg.other : msg.one, [count]);

		if (arguments.length > 3) {
			msg = vsprintf(msg, Array.prototype.slice.call(arguments, 3));
		}

		return msg;
	},

	setLocale: function(locale) {

		if (!locale) return;
		
		if (!this.locales[locale]) {
			if (this.devMode) {
				console.warn("Locale (" + locale + ") not found.");
			}

			locale = this.defaultLocale;
		}

		return (this.locale = locale);
	},

	getLocale: function() {
		return this.locale;
	},

	isPreferredLocale: function() {
		return !this.prefLocale ||
			this.prefLocale === this.getLocale();
	},

	setLocaleFromQuery: function(request) {
        if (!request || !request.url || !request.url.match(/^\/([^\/]+)/)) {
            return;
        }

        var locale = request.url.match(/^\/([^\/]+)/)[1].toLowerCase();

        if (this.locales[locale]) {
            this.setLocale(locale);
			return locale;
		}
	},

	getLocaleFromCookie: function(request) {
        if (!request || !request.cookies || !this.cookiename || !request.cookies[this.cookiename]) {
            return;
        }

        return request.cookies[this.cookiename].toLowerCase();
    },

    setLocaleFromCookie: function(request) {
        var locale = this.getLocaleFromCookie(request);

        if (this.locales[locale]) {
            this.setLocale(locale);
        }
    },

    setLocaleFromQueryOrCookie: function(request, response) {
        var queryLocale = this.setLocaleFromQuery(request);

        if (typeof queryLocale !== 'undefined') {
            if (this.getLocaleFromCookie(request) !== queryLocale) {
                response.cookie('locale', queryLocale);
            }

            return;
        }

        this.setLocaleFromCookie(request);
    },

	preferredLocale: function(req) {
		req = req || this.request;

		if (!req || !req.headers) {
			return;
		}

		var accept = req.headers["accept-language"] || "",
			self = this,
			prefLocale;

		(accept.match(/(^|,\s*)([a-z]+)/g) || []).forEach(function(locale) {
			if (!prefLocale && self.locales[locale]) {
				prefLocale = locale;
			}
		});

		return prefLocale || this.defaultLocale;
	},

	// read locale file, translate a msg and write to fs if new
	translate: function(locale, singular, plural) {
		if (!locale || !this.locales[locale]) {
			if (this.devMode) {
				console.warn("WARN: No locale found. Using the default (" +
					this.defaultLocale + ") as current locale");
			}

			locale = this.defaultLocale;

			this.initLocale(locale, {});
		}

		if (!this.locales[locale][singular]) {
			this.locales[locale][singular] = plural ?
				{ one: singular, other: plural } :
				singular;

			if (this.devMode) {
				this.writeFile(locale);
			}
		}

		return this.locales[locale][singular];
	},

	// try reading a file
	readFile: function(locale) {
		var file = this.locateFile(locale);

		if (!this.devMode && i18n.localeCache[file]) {
			this.initLocale(locale, i18n.localeCache[file]);
			return;
		}

		try {
			var localeFile = fs.readFileSync(file);

			try {
				// parsing filecontents to locales[locale]
				this.initLocale(locale, JSON.parse(localeFile));

			} catch (e) {
				console.error('unable to parse locales from file (maybe ' + file +
					' is empty or invalid json?): ', e);
			}

		} catch (e) {
			// unable to read, so intialize that file
			// locales[locale] are already set in memory, so no extra read required
			// or locales[locale] are empty, which initializes an empty locale.json file
			this.writeFile(locale);
		}
	},

	// try writing a file in a created directory
	writeFile: function(locale) {
		// don't write new locale information to disk if we're not in dev mode
		if (!this.devMode) {
			// Initialize the locale if didn't exist already
			this.initLocale(locale, {});
		}

		// creating directory if necessary
		try {
			fs.lstatSync(this.directory);

		} catch (e) {
			if (this.devMode) {
				console.log('creating locales dir in: ' + this.directory);
			}

			fs.mkdirSync(this.directory, 0755);
		}

		// Initialize the locale if didn't exist already
		this.initLocale(locale, {});

		// writing to tmp and rename on success
		try {
			var target = this.locateFile(locale),
				tmp = target + ".tmp";

			fs.writeFileSync(tmp, JSON.stringify(
				this.locales[locale], null, "\t"), "utf8");

			if (fs.statSync(tmp).isFile()) {
				fs.renameSync(tmp, target);

			} else {
				console.error('unable to write locales to file (either ' + tmp +
					' or ' + target + ' are not writeable?): ');
			}

		} catch (e) {
			console.error('unexpected error writing files (either ' + tmp +
				' or ' + target + ' are not writeable?): ', e);
		}
	},

	// basic normalization of filepath
	locateFile: function(locale) {
		return path.normalize(this.directory + '/' + locale + this.extension);
	},

	initLocale: function(locale, data) {
		if (!this.locales[locale]) {
			this.locales[locale] = data;

			// Only cache the files when we're not in dev mode
			if (!this.devMode) {
			    var file = this.locateFile(locale);
				if ( !i18n.localeCache[file] ) {
			    	i18n.localeCache[file] = data;
				}
			}
		}
	}
};
