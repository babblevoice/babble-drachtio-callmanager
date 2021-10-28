
const assert = require( "assert" )
const events = require( "events" )
const callmanager = require( "./lib/callmanager.js" )

const default_options = {
  "preferedcodecs": "g722 ilbc pcmu pcma",
  "transcode": true,
  "uactimeout": 30000, /* timeout when calling a client */
  "seexpire": 120000, /* session expires timeout */
  "rfc2833": true,  /* Enable RFC 2833 - DTMF */
  "late": false  /* Late negotiation */
}

module.exports.callmanager = async( options ) => {
  Object.assign( options, default_options )
  return callmanager.callmanager( options )
}

module.exports.hangupcodes = callmanager.hangupcodes
