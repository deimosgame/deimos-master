#!/bin/env node
// New Relic agent
require('newrelic');
// Heapdump snapshots
// require('heapdump');
// Common dependencies
var express = require('express');
var mysql	= require('mysql');
var winston = require('winston');
var config	= require('./config.json');

/**
 *  Main AkadokMaster class
 */
var AkadokMaster = function() {

	// Scope
	var self = this;


	/*  ================================================================  */
	/*  Helper functions for server initialization						  */
	/*  ================================================================  */

	/**
	 *  Set up server IP address and port # using env variables/defaults.
	 */
	self.setupVariables = function() {
		// Set the environment variables we need.
		self.ipaddress = '127.0.0.1';
		self.port	   = 1518;
		// Database config
		self.db			= null;
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
		// Process on exit and signals.
		process.on('exit', function() { self.terminator(); });
		['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
		 'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGTERM'
		].forEach(function(element, index, array) {
			process.on(element, function() {
				self.terminator(element);
			});
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
	 *	MySQL database connection
	 */
	self.connectDb = function() {
		self.db = mysql.createConnection({
			host	 : config.db.host,
			user	 : config.db.user,
			password : config.db.password
		});
		self.db.connect(function(err) {
			console.log(err);
			if (typeof err !== 'undefined') {
				winston.error('Database connection error! Check your credentials and your host!');
				winston.error('Error details %s: %s', err.fatal ? '(fatal)' : '', err.code);
				self.terminator('ERROR');
				return;
			}
			if (config.verbose)
				winston.info('Connected to database successfully');
		});

	};


	/**
	 *	MySQL database disconnection
	 */
	self.disconnectDb = function() {
		self.db.end();
		if (config.verbose)
			winston.info('Connection to MySQL dropped');
	};


	/*	==================================================================	*/
	/*	Helper functions													*/
	/*	==================================================================	*/


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
		app.use(express.json());

		// Main route to get server list
		app.get('/', function(req, res) {
			if (config.verbose)
				winston.info('Request from %s for server list',
					req.realIp());
			res.json(200, self.servers);
		});

		// Route used to get client's external IP
		app.get('/ip', function(req, res) {
			if (config.verbose)
				winston.info('Request for IP from %s',
					req.realIp());
			res.json(200, {
				success: true,
				ip: req.realIp()
			});
		});

		/**
		 *	Route used by servers to signal themselves
		 *	(same route for registration and heartbeat)
		 */
		app.post('/', function(req, res) {
			var server = {
				ip: req.realIp(),
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
			if (server.players !== '' && 
				typeof server.players === 'undefined') {
				res.json(400, { error: 'Bad request' });
				return;
			}
			if (typeof server.maxplayers !== 'number' ||
				!(server.maxplayers > 0)) {
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
		self.connectDb();
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

// Gets the current timestamp
var timestamp = function() {
	return Math.round(new Date().getTime() / 1000);
};


// Gets the real ip of a client, bypassing OpenShift proxies
express.request.__proto__.realIp = function() {
	var headers = [
		'X-Forwarded-For',
		'Proxy-Client-IP',
		'WL-Proxy-Client-IP',
		'HTTP_CLIENT_IP',
		'HTTP_X_FORWARDED_FOR'];
	for (var i = 0; i < headers.length; i++) {
		var ip = this.get(headers[i]);
		if (typeof ip !== 'undefined' &&
			ip.length !== 0 &&
			ip.toLowerCase() !== 'unknown')
			return ip;
	}
	return this.ip;
};
