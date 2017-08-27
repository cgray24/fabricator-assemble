// modules
var _ = require('lodash');
var beautifyHtml = require('js-beautify').html;
var chalk = require('chalk');
var fs = require('fs');
var globby = require('globby');
var Handlebars = require('handlebars');
var inflect = require('i')();
var matter = require('gray-matter');
var md = require('markdown-it')({ html: true, linkify: true });
var mkdirp = require('mkdirp');
var path = require('path');
var sortObj = require('sort-object');
var yaml = require('js-yaml');
var anymatch = require('anymatch');


var logging = true;


/**
 * Default options
 * @type {Object}
 */
var defaults = {
	/**
	 * ID (filename) of default layout
	 * @type {String}
	 */
	layout: 'default',

	/**
	 * Layout templates
	 * @type {(String|Array)}
	 */
	layouts: ['src/views/layouts/*'],

	/**
	 * Layout includes (partials)
	 * @type {String}
	 */
	layoutIncludes: ['src/views/layouts/includes/*'],

	/**
	 * Pages to be inserted into a layout
	 * @type {(String|Array)}
	 */
	views: ['src/views/**/*', '!src/views/+(layouts)/**'],

	/**
	 * Materials - snippets turned into partials
	 * @type {(String|Array)}
	 */
	materials: ['src/materials/**/*'],

	/**
	 * CSS - snippets turned into partials
	 * @type {(String|Array)}
	 */
	css: ['src/assets/toolkit/styles/components/*'],

	/**
	 * JS - snippets turned into partials
	 * @type {(String|Array)}
	 */
	js: ['src/assets/toolkit/scripts/modules/*'],

	/**
	 * JSON or YAML data models that are piped into views
	 * @type {(String|Array)}
	 */
	data: ['src/data/**/*.{json,yml}'],

	/**
	 * Markdown files containing toolkit-wide documentation
	 * @type {(String|Array)}
	 */
	docs: ['src/docs/**/*.md'],

	/**
	 * Keywords used to access items in views
	 * @type {Object}
	 */
	keys: {
		materials: 'materials',
		views: 'views',
		docs: 'docs'
	},

	/**
	 * Location to write files
	 * @type {String}
	 */
	dest: 'dist',

	/**
	 * beautifier options
	 * @type {Object}
	 */
	beautifier: {
		indent_size: 1,
		indent_char: '	',
		indent_with_tabs: true
	},

	/**
	 * Function to call when an error occurs
	 * @type {Function}
	 */
	onError: null,

	/**
	 * Whether or not to log errors to console
	 * @type {Boolean}
	 */
	logErrors: false
};


/**
 * Merged defaults and user options
 * @type {Object}
 */
var options = {};


/**
 * Assembly data storage
 * @type {Object}
 */
var assembly = {
	/**
	 * Contents of each layout file
	 * @type {Object}
	 */
	layouts: {},

	/**
	 * Parsed JSON data from each data file
	 * @type {Object}
	 */
	data: {},

	/**
	 * Meta data for materials, grouped by "collection" (sub-directory); contains name and sub-items
	 * @type {Object}
	 */
	materials: {},

	/**
	 * Meta data for CSS, grouped by "collection" (sub-directory); contains name and sub-items
	 * @type {Object}
	 */
	css: {},

	/**
	 * Meta data for CSS, grouped by "collection" (sub-directory); contains name and sub-items
	 * @type {Object}
	 */
	js: {},

	/**
	 * Each material's front-matter data
	 * @type {Object}
	 */
	materialData: {},

	/**
	 * Meta data for user-created views (views in views/{subdir})
	 * @type {Object}
	 */
	views: {},

	/**
	 * Meta data (name, sub-items) for doc file
	 * @type {Object}
	 */
	docs: {}

};  //end of defaults===========



//FUNCTIONS =====================

/**
 * Get the name of a file (minus extension) from a path
 * @param  {String} filePath
 * @example
 * './src/materials/structures/foo.html' -> 'foo'
 * './src/materials/structures/02-bar.html' -> 'bar'
 * @return {String}
 */
var getName = function (filePath, preserveNumbers) {
	// get name; replace spaces with dashes
	var name = path.basename(filePath, path.extname(filePath)).replace(/\s/g, '-');
	return (preserveNumbers) ? name : name.replace(/^[0-9|\.\-]+/, '');

};




/**
 * Attempt to read front matter, handle errors
 * @param  {object or string} Message To Log
 * @return none
 */
var log = function (message) {
	if(logging){
		console.log("====== LOGGER ===============");
		console.log(message);
	}
};

/**
 * Attempt to read front matter, handle errors
 * @param  {String} file Path to file
 * @return {Object}
 */
var getMatter = function (file) {
	return matter.read(file, {
		parser: require('js-yaml').safeLoad
	});
};




/**
 * Convert a file name to title case
 * @param  {String} str
 * @return {String}
 */
var toTitleCase = function(str) {
	return str.replace(/(\-|_)/g, ' ').replace(/\w\S*/g, function(word) {
		return word.charAt(0).toUpperCase() + word.substr(1).toLowerCase();
	});
};


var config = {
	ext: '.html',
	config: 'config',
	splitter: '--'
}


var isView = function (file) {
    return anymatch([
        `**/*.html`,
    ], file);
}

var isVariant = function (file) {
	return anymatch([
		`**/*${config.splitter}*`
	], file);
}



/**
 * Handle errors
 * @param  {Object} e Error object
 */
var handleError = function (e) {

	// default to exiting process on error
	var exit = true;

	// construct error object by combining argument with defaults
	var error = _.assign({}, {
		name: 'Error',
		reason: '',
		message: 'An error occurred',
	}, e);

	// call onError
	if (_.isFunction(options.onError)) {
		options.onError(error);
		exit = false;
	}

	// log errors
	if (options.logErrors) {
		console.error(chalk.bold.red('Error (fabricator-assemble): ' + e.message + '\n'), e.stack);
		exit = false;
	}

	// break the build if desired
	if (exit) {
		console.error(chalk.bold.red('Error (fabricator-assemble): ' + e.message + '\n'), e.stack);
		process.exit(1);
	}

};



/**
 * Parse layout files
 */
var parseLayouts = function () {

	// reset
	assembly.layouts = {};

	// get files
	var files = globby.sync(options.layouts, { nodir: true });

	// save content of each file
	files.forEach(function (file) {
		var id = getName(file);
		var content = fs.readFileSync(file, 'utf-8');
		assembly.layouts[id] = content;
	});

};


/**
 * Register layout includes has Handlebars partials
 */
var parseLayoutIncludes = function () {

	// get files
	var files = globby.sync(options.layoutIncludes, { nodir: true });

	// save content of each file
	files.forEach(function (file) {
		var id = getName(file);
		var content = fs.readFileSync(file, 'utf-8');
		Handlebars.registerPartial(id, content);
	});

};



/**
 * Register new Handlebars helpers
 */
var registerHelpers = function () {

	// get helper files
	var resolveHelper = path.join.bind(null, __dirname, 'helpers');
	var localHelpers = fs.readdirSync(resolveHelper());
	var userHelpers = options.helpers;

	// register local helpers
	localHelpers.map(function (helper) {
		var key = helper.match(/(^\w+?-)(.+)(\.\w+)/)[2];
		var path = resolveHelper(helper);
		Handlebars.registerHelper(key, require(path));
	});

	// register user helpers
	for (var helper in userHelpers) {
		if (userHelpers.hasOwnProperty(helper)) {
			Handlebars.registerHelper(helper, userHelpers[helper]);
		}
	}
	/**
	 * Helpers that require local functions like `buildContext()`
	 */

	/**
	 * `material`
	 * @description Like a normal partial include (`{{> partialName }}`),
	 * but with some additional templating logic to help with nested block iterations.
	 * The name of the helper is the singular form of whatever is defined as the `options.keys.materials`
	 * @example
	 * {{material name context}}
	 */
	Handlebars.registerHelper(inflect.singularize(options.keys.materials), function (name, context, opts) {

		// remove leading numbers from name keyword
		// partials are always registered with the leading numbers removed
		// This is for both the subCollection as the file(name) itself!
		var key = name.replace(/(\d+[\-\.])+/, '').replace(/(\d+[\-\.])+/, '');

		// attempt to find pre-compiled partial
		var template = Handlebars.partials[key],
			fn;

		// compile partial if not already compiled
		if (!_.isFunction(template)) {
			fn = Handlebars.compile(template);
		} else {
			fn = template;
		}

		// return beautified html with trailing whitespace removed
		return beautifyHtml(fn(buildContext(context, opts.hash)).replace(/^\s+/, ''), options.beautifier);

	});
};



/**
 * Parse data files and save JSON
 */
var parseData = function () {

	// reset
	assembly.data = {};

	// get files
	var files = globby.sync(options.data, { nodir: true });

	// save content of each file
	files.forEach(function (file) {
		var id = getName(file);
		var content = yaml.safeLoad(fs.readFileSync(file, 'utf-8'));
		assembly.data[id] = content;
	});

};




/**
 * Parse each material - collect data, create partial
 */
var parseMaterials = function () {

		// reset object
		assembly.materials = {};

		options.materials.forEach(function(path){
			var materialBase = getName(path);
			var pathSearch = path + '**/*/';
			// get the material base dir for stubbing out the base object for each category (e.g. component, structure)

			// get files and dirs
			var components = globby.sync(pathSearch, {nosort: true });

			if(!components.length){return;} //stop looking if no components, should really look for templates

			console.log(getName(materialBase));

			assembly.materials[materialBase] = assembly.materials[materialBase] || {
					name: toTitleCase(getName(materialBase)),
					items: {}
				};

			// iterate over each component
			components.forEach(function(component){
				console.log("== " + getName(component));

				var pathSearch = component + '**/*';

				console.log(pathSearch);
				// get files
				var files = globby.sync(pathSearch, {nosort: true });



				files.forEach(function(file){
					console.log("Is View?  " + file);
					console.log(isView(file));

					console.log("Is Variant?  " + file);
					console.log(isVariant(file));


				})






				// console.log("== "+ getName(component));
				//
				// var componentName = getName(component);


				//assembly.materials[materialBase].items







			}); // each components








		}); // each materials




console.log(assembly.materials);

		// get files and dirs

		// build a glob for identifying directories
		// options.materials = (typeof options.materials === 'string') ? [options.materials] : options.materials;
		// var dirsGlob = options.materials.map(function (pattern) {
		// 	return path.dirname(pattern) + '/*/';
		// });

		// get all directories
		// do a new glob; trailing slash matches only dirs
		// var dirs = globby.sync(dirsGlob).map(function (dir) {
		// 	return path.normalize(dir).split(path.sep).slice(-2, -1)[0];
		// });

		//console.log("dirs");
		//console.log(dirs);


}







/**
 * Setup the assembly
 * @param  {Objet} options  User options
 */
	var setup = function (userOptions) {

	// merge user options with defaults
	options = _.merge({}, defaults, userOptions);

	// require("./lib/registerHelper.js");
	// require("/lib/parse-layouts.js");
	// require("/lib/parse-layoutIncludes.js");

	// setup steps
	log("Registering Helpers");
	registerHelpers();

	log("Parsing Layouts");
	parseLayouts();

	log("Parse Layout Includes");
	parseLayoutIncludes();

	// parseCSS();
	// parseJS();
	 parseData();
	 parseMaterials();
	// parseViews();
	// parseDocs();


};



// END OF FUNCTIONS =================




/**
 * Module exports
 * @return {Object} Promise
 */
module.exports = function (options) {

	try {
		// setup assembly
		setup(options);

		// assemble
		//assemble();

	} catch(e) {
		handleError(e);
	}

};
