#!/bin/env node
var express = require('express');
var winston = require('winston');
var config	= require('./config.json');

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
		self.port	   = process.env.OPENSHIFT_NODEJS_PORT || config.alternative_port;

		if (typeof self.ipaddress === 'undefined') {
			// Log errors on OpenShift but continue w/ 127.0.0.1 - this
			// allows us to run/test the app locally.
			winston.warn('Environement not supported (run on OpenShift!)');
			self.ipaddress = '127.0.0.1';
		};

		// Setup an empty list of game servers
		self.servers = {};
	};


	/**
	 *  Termination handler
	 *  Terminate server on receipt of the specified signal.
	 *  @param {string} sig  Signal to terminate on.
	 */
	self.terminator = function(sig) {
		if (typeof sig === 'string') {
		   winston.info('Received %s - master server is going down.', sig);
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
			filename: config.log_file
		});
		if (config.verbose)
			winston.info('Verbose mode is ENABLED');
	};

	/**
	 *  Removes servers idle for more than 20 seconds
	 */
	self.removeIdleServers = function() {
		var currentTimestamp = timestamp();
		for (var currentServer in self.servers) {
			if (!self.servers.hasOwnProperty(currentServer))
				continue;
			var server = self.servers[currentServer];
			if (currentTimestamp - server.lastRefresh > config.max_idle_time) {
				// Remove the server from servers object
				delete self.servers[currentServer];
				winston.info('Removed idle server %s (%s)',
					currentServer, server.name);
			}
		}
	};

	/**
	 *  Scheduled task allowing to remove idle/closed servers automatically
	 *  - is executed every 5 seconds
	 */
	self.initScheduledTask = function() {
		setInterval(self.removeIdleServers, config.idle_check_frequency * 1000);
	};

	/*  ================================================================  */
	/*  App server functions											  */
	/*  ================================================================  */

	/**
	 *  Create the routing entries + handlers for the application.
	 */
	self.initializeServer = function() {
		var app = express();
		app.use(express.multipart());

		// Main route to get server list
		app.get('/', function(req, res) {
			if (config.verbose)
				winston.info('Request from %s for server list', req.ip);
			res.json(200, self.servers);
		});

		/**
		 *	Route used by servers to signal themselves
		 *	(same route for registration and heartbeat)
		 */
		app.post('/', function(req, res) {
			var server = {
				ip: req.ip,
				port: parseInt(req.body.port),
				name: req.body.name,
				map: req.body.map,
				players: req.body.players,
				maxplayers: parseInt(req.body.maxplayers),
				lastRefresh: timestamp()
			}
			// Some validation to prevent errors
			if (typeof server.port !== 'number' || !(server.port > 0)) {
				res.json(400, { error: 'Bad request' });
				return;
			}
			if (typeof server.players === 'undefined') {
				res.json(400, { error: 'Bad request' });
				return;
			}
			if (typeof server.maxplayers !== 'number' || !(server.maxplayers > 0)) {
				res.json(400, { error: 'Bad request' });
				return;
			}
			// Final cleanup of players
			server.players = server.players.split(',');
			server.players = server.players.map(function (currentPlayer) {
				return currentPlayer.trim();
			});
			// Check if the server is created or updated
			var serverKey = server.ip + ':' + server.port;
			if (self.servers.hasOwnProperty(serverKey)) {
				if (config.verbose)
					winston.info('Received heartbeat from %s (%s)',
						serverKey, server.name);
				self.servers[serverKey] = server;
			}
			else {
				winston.info('Server %s:%d (%s) joined server list',
					server.ip, server.port, server.name);
				self.servers[serverKey] = server;
			}
			// Changes are saved
			res.json(200, { success: true });
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
		self.initScheduledTask();
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
			winston.info('Akadok master server started on %s:%d.',
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


/**
 *  Some more useful functions
 */
var timestamp = function() {
	return Math.round(new Date().getTime() / 1000);
};