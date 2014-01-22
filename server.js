#!/bin/env node
var express = require('express');
var winston = require('winston');


/**
 *  Main AkadokMaster class
 */
var AkadokMaster = function() {

	//  Scope
	var self = this;


	/*  ================================================================  */
	/*  Helper functions.												 */
	/*  ================================================================  */

	/**
	 *  Set up server IP address and port # using env variables/defaults.
	 */
	self.setupVariables = function() {
		// Set the environment variables we need.
		self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
		self.port	   = process.env.OPENSHIFT_NODEJS_PORT || 8080;

		if (typeof self.ipaddress === 'undefined') {
			// Log errors on OpenShift but continue w/ 127.0.0.1 - this
			// allows us to run/test the app locally.
			winston.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
			self.ipaddress = '127.0.0.1';
		};

		// Setup an empty list of game servers
		self.servers = [];
	};


	/**
	 *  Termination handler
	 *  Terminate server on receipt of the specified signal.
	 *  @param {string} sig  Signal to terminate on.
	 */
	self.terminator = function(sig) {
		if (typeof sig === 'string') {
		   winston.info('Received %s - master server is going down...', sig);
		   process.exit(1);
		}
		winston.info('Master server stopped.');
	};


	/**
	 *  Setup termination handlers (for exit and a list of signals).
	 */
	self.setupTerminationHandlers = function() {
		//  Process on exit and signals.
		process.on('exit', function() { self.terminator(); });
		['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
		 'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
		].forEach(function(element, index, array) {
			process.on(element, function() { self.terminator(element); });
		});
	};

	/**
	 *	Winston logging initialization
	 */
	self.initLogging = function() {
		// We enable file logging
		winston.add(winston.transports.File, {
			filename: 'server.log'
		});
	};

	/*  ================================================================  */
	/*  App server functions											  */
	/*  ================================================================  */

	/**
	 *  Create the routing entries + handlers for the application.
	 */
	self.initializeServer = function() {
		var app = express();
		app.use(express.json());
		app.use(express.urlencoded());

		// Main route to get server list
		app.get('/', function(req, res) {
			res.status(200).json(self.servers);
		});

		/**
		 *	Route used by servers to signal themselves
		 *	(same route for registration and heartbeat)
		 */
		app.post('/', function(req, res) {

		});

		// Route for manually unregistering servers
		app.delete('/', function(req, res) {

		});

		self.app = app;
	};

	/**
	 *  Initializes the server
	 */
	self.initialize = function() {
		// Misc initialization
		self.initLogging();
		self.setupVariables();
		self.setupTerminationHandlers();

		// Create the express server and routes.
		self.initializeServer();
	};


	/**
	 *  Start the server
	 */
	self.start = function() {
		//  Start the app on the specific interface (and port).
		self.app.listen(self.port, self.ipaddress, function() {
			winston.info('Akadok master server started on %s:%d...',
				self.ipaddress, self.port);
		});
	};

};

/**
 *  Server creation
 */
var akadok = new AkadokMaster();
akadok.initialize();
akadok.start();