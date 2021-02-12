
/*
TODO

* In calls dict clean up when calls are hung up
*/

const assert = require( "assert" )
const events = require('events')
const parseuri = require( "drachtio-srf" ).parseUri

/* RTP */
const projectrtp = require( "babble-projectrtp" ).ProjectRTP

const hangupcodes = require( "./lib/call.js" ).hangupcodes
const call = require( "./lib/call.js" ).call
const callstore = require( "./lib/store.js" )


const default_options = {
  "preferedcodecs": "g722 ilbc pcmu pcma",
  "transcode": true,
  "debug": false,
  "uactimeout": 30000,
  "rfc2833": true
}


class callmanager {
  /*
  options supplied can also be provided in a call object or be provided to functions like answer
  all 3 objects are joined the the function, call, callmanager (in that order) being used.
  */
  constructor( options ) {

    this.rtp = new projectrtp()
    this.rtp.on( "connection", ( conn ) => {
      if( this.options.debug ) {
        console.log( "projectrtp connected" )
      }
    } )

    this.options = { ...default_options, ...options }

    if( this.options.debug ) {
      this.consolelog = ( c, data ) => {
        console.log( c.uuid + ": " + data )
      }
    } else {
      this.consolelog = ( c, data ) => {}
    }

    this.authdigest = digestauth( {
      "proxy": true, /* 407 or 401 */
      "passwordLookup": this.options.passwordLookup
    } )

    this.options.srf.use( "invite", this.oninvite )

    assert( undefined !== this.options.srf )

    if( undefined === this.options.em ) {
      this.options.em = new events.EventEmitter()
    }

    this.options.em.on( "call", ( c ) => {

      if( false !== this.onnewcall ) {

        this.onnewcall( c )
          .catch( ( err ) => {
            try {
              console.error( err )
              if( false === c.destroyed ) {
                consolelog( c, "Unhandled exception - hanging up" )
                c.hangup( hangupcodes.SERVER_ERROR )
              }
            } catch( err ) {
              console.error( err )
            }
          } )
      }
    } )

    this.onnewcall = false

    /* Track inbound calls. Outbound calls are not stored here */
    this.calls = new Map()
  }

  on( event, cb ) {
    if( "call" === event ) {
      this.onnewcall = cb
    } else {
      /* not used just yet */
      this.options.em.on( event, cb )
    }
  }

  get hangupcodes() {
    return hangupcodes
  }

  oninvite( req, res, next ) {

    if( req.method !== "INVITE" ) return next()

    callstore.getbysourceandcallid( req.source_address, req.msg.headers[ "call-id" ] )
      .then( ( c ) => {
        c._onauth( req, res )
        return
      } )
      .catch( () => {
        let c = new call( req, res )
        callstore.set( c )
        singleton.options.em.emit( "call", c )
        return
      } )
  }
}

module.exports.callmanager = callmanager
module.exports.hangupcodes = hangupcodes
