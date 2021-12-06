
const assert = require( "assert" )
const events = require( "events" )

const callstore = require( "./store.js" )
const call = require( "./call.js" )


/** @class */
class callmanager {
  /**
  Construct our callmanager object with all defaults.
  @constructor
  @hideconstructor
  @param {object} options
  */
  constructor( options ) {
    this.onnewcall = false
    this.options = options

    if( undefined === this.em ) {
      this.options.em = new events.EventEmitter()
    }
  }


  /**
    Configure our call manager to listen for invite events from dratchio
    @private
  */
  async _use() {
    this.options.srf.use( "invite", this._oninvite.bind( this ) )
  }

  /**
    Parse invite maessages from drachtio.
    @private
  */
  async _oninvite( req, res, next ) {
    if( req.msg.method !== "INVITE" ) return next()

    let calldesc = {
      "callid": req.getParsedHeader( "call-id" ),
      "tags": {
        "remote": req.getParsedHeader( "from" ).params.tag,
        "local": ""
      }
    }

    let c = await callstore.getbycallid( calldesc )
    if( c ) return c._onauth( req, res )

    c = call.frominvite( req, res )

    if( false !== this.onnewcall ) {
      try {
        await this.onnewcall( c )
      } catch( e ) {
        c.hangup( this.hangupcodes.SERVER_ERROR )
      }
    }
  }

  /**
    Callback registered to process a new call.
    @callback oncallCallback
    @param {call} call a new call object.
  */

  /**
    Register callback to handle newcall events.
    @param {string} event - the event type - only "call" supported
    @param {oncallCallback} cb
  */
  on( event, cb ) {
    if( "call" === event ) {
      this.onnewcall = cb
    }
  }

  /**
    Return dict of hangup-codes
  */
  get hangupcodes() {
    return call.hangupcodes
  }
}

/** @module callmanager */
/**
@function callmanager
@summary create and return the instance of the callmanager (only one can be created).
Is configured to use drachtio and registers emitter for presence.
@return {callmanager}
*/
let cm = false
module.exports.callmanager = async ( options ) => {
  if( cm !== false ) return cm

  assert( undefined !== options.srf )
  cm = new callmanager( options )
  call.setcallmanager( cm )
  await cm._use()
  return cm
}

module.exports.hangupcodes = call.hangupcodes

/* Only used for testing - not expected to be used in production */
module.exports._clear = () => {
  cm = false
  callstore.clear()
}
