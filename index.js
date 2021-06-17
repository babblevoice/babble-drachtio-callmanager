
/*
TODO

* In calls dict clean up when calls are hung up
*/

const assert = require( "assert" )
const events = require('events')

/* RTP */
const projectrtp = require( "babble-projectrtp" ).ProjectRTP

const hangupcodes = require( "./lib/call.js" ).hangupcodes
const call = require( "./lib/call.js" ).call
const setcalllog = require( "./lib/call.js" ).setconsolelog
const setcallmanager = require( "./lib/call.js" ).setcallmanager
const callstore = require( "./lib/store.js" )


const default_options = {
  "preferedcodecs": "g722 ilbc pcmu pcma",
  "transcode": true,
  "debug": false,
  "uactimeout": 30000, /* timeout when calling a client */
  "seexpire": 120000, /* session expires timeout */
  "rfc2833": true,  /* Enable RFC 2833 - DTMF */
  "late": false  /* Late negotiation - default true */
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

    if( undefined === this.options.em ) {
      this.options.em = new events.EventEmitter()
    }

    if( this.options.debug ) {
      this.consolelog = ( c, data ) => {
        console.log( c.uuid + ": " + data )
      }
      setcalllog( this.consolelog )
    } else {
      this.consolelog = ( c, data ) => {}
    }

    setcallmanager( this )

    this.options.srf.use( "invite", ( req, res, next ) => {
      if( req.method !== "INVITE" ) return next()

      let calldesc = {
        "callid": req.getParsedHeader( "call-id" ),
        "tags": {
          "remote": req.getParsedHeader( "from" ).params.tag,
          "local": ""
        }
      }

      callstore.getbycallid( calldesc )
        .then( ( c ) => {
          c._onauth( req, res )
          return
        } )
        .catch( () => {
          let c = new call( req, res )
          callstore.set( c )
          this.options.em.emit( "call", c )
          return
        } )
    } )

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
                this.consolelog( c, "Unhandled exception - hanging up" )
                c.hangup( hangupcodes.SERVER_ERROR )
              }
            } catch( err ) {
              console.error( err )
            }
          } )
      }
    } )

    this.onnewcall = false

    this.options.em.on( "presence.subscribe.in", ( v ) => {
      if( "application/dialog-info+xml" === v.contenttype ) {
        callstore.getbyentity( v.entity )
          .then( ( s ) => {
            this.options.em.emit( "presence.dialog.out", {
              "entity": v.entity,
              "display": "Miss Piggy",
              "all": s
            } )
          } )
          .catch( () => {
            this.options.em.emit( "presence.dialog.out", {
              "entity": v.entity,
              "display": "Miss Piggy"
            } )
          } )
      }
    } )
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

}

module.exports.callmanager = callmanager
module.exports.hangupcodes = hangupcodes
