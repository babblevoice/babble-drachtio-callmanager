
/*
TODO

* In calls dict clean up when calls are hung up
*/

'use strict'

const assert = require( "assert" )
const events = require('events')
const digestauth = require( "drachtio-mw-digest-auth" )
const regparser = require( "drachtio-mw-registration-parser" )
const parseuri = require( "drachtio-srf" ).parseUri

/* RTP */
const projectrtp = require( "babble-projectrtp" ).ProjectRTP
const sdpgen = require( "babble-projectrtp" ).sdp
const { v4: uuidv4 } = require( "uuid" )

const rtp = new projectrtp()

class call {

  constructor( req, res ) {
    this.uuid = uuidv4()

    consolelog( this, "new call" )
    this.ringing = false
    this.established = false
    this.canceled = false
    this.destroyed = false
    this.type = "unknown"
    this.sdp = {}

    /* an array of channels */
    this.chs = []

    /* UACs we create */
    this.children = []
    this.parent = false

    if( undefined !== req ) {

      this.source_address = req.source_address
      this.sip = {}
      this.sip.callid = req.msg.headers[ "call-id" ]

      this.req = req
      this.res = res
      this.type = "uas"

      this.req.on( "cancel", () => this._oncanceled() )
    }
  }

  newuac( contact, from ) {

    let newcall = new call()
    newcall.type = "uac"
    newcall.parent = this
    this.children.push( newcall )

    var p = new Promise( ( resolve, reject ) => {
      newcall.newuacresolve = resolve
      newcall.newuacreject = reject
    } )

    singleton.options.srf.createUAC( contact, {
        headers: {
          "From": from
        },
        noAck: true
      },
      {
        cbRequest: ( err, req ) => {
          newcall.req = req
        },
        cbProvisional: ( res ) => {
          newcall.res = res
          if( 180 === res.status ) {
            newcall._onring()
          }
        }
      } )
      .then( ( dlg ) => {
        newcall.dialog = dlg
        newcall.sdp.remote = sdpgen.create( dlg.sdp )
        newcall.established = true
        newcall._onanswer()
      } )
      .catch( ( err ) => {

        if ( undefined !== err.status ) {
          let reason = hangup_codes.REQUEST_TERMINATED
          if( 486 === err.status ) {
            reason = hangup_codes.USER_BUSY
          }

          newcall._onhangup( "wire", reason )
          newcall.newuacreject()
        } else {
          consolelog( this, err )
        }
      } )

    return p
  }

  /* Called from newuac when we receive a 180 */
  _onring() {
    if( false !== this.parent ) {
      consolelog( this, "received 180 ringing" )
      this.parent.ring()
    }
  }

  /* Called from newuac when we are answered and we have a dialog, this - child call */
  _onanswer() {
    if( undefined !== this.parent ) {
      if( undefined !== this.parent.children ) {
        this.parent.children.forEach( ( child ) => {
          if( child.uuid !== this.uuid ) {
            child.hangup()
          }
        } )
      }
      this.parent.children = [ this ]
    }

    /* We now have 2 calls, we may need to answer the parent */
    /* We have this.dialog (srf dialog object) and this.sdp.remote (sdp object) */
    if( this.parent.established ) {
      this.selectedcodec = this.sdp.remote.intersection( singleton.options.preferedcodecs, true )
      consolelog( this, "remote codec chosen: " + this.selectedcodec )

      rtp.channel( this.sdp.remote.select( this.selectedcodec ) )
        .then( ch => {
          this.chs.push( ch )

          this.sdp.local = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )
          this.dialog.ack( this.sdp.local.toString() )
            .then( ( dlg ) => {
              this.dialog = dlg
              this.addevents( this.dialog )
              this.audio.mix( this.parent.audio )
              this.newuacresolve( this )

            } )

          if( this.canceled ) {
            this.newuacreject()
            return
          }
        } )
      } else {
        /* parent is not established */
        let remotecodecs = this.sdp.remote.intersection( singleton.options.preferedcodecs )
        consolelog( this, "remote codecs (late negotiation) chosen: " + remotecodecs )

        this.parent.answer( { "preferedcodecs": remotecodecs } )
          .then( () => {

            this.selectedcodec = this.parent.selectedcodec

            this.sdp.local = sdpgen.create().addcodecs( this.selectedcodec )
            rtp.channel( this.sdp.local )
              .then( ch => {
                this.sdp.local.setchannel( ch )
                this.chs.push( ch )
                this.dialog.ack( this.sdp.local.toString() )
                  .then( ( dlg ) => {
                    this.dialog = dlg
                    this.addevents( this.dialog )
                    this.audio.mix( this.parent.audio )
                    this.newuacresolve( this )
                  } )
              } )
          } )
          .catch( () => {
            this.newuacreject( this )
          } )
      }
  }

  get destination() {
    return parseuri( this.req.msg.uri )
  }

  /*
    auth - returns promise.
  */
  auth() {
    var p = new Promise( ( resolve, reject ) => {
      this.authresolve = resolve
      this.authreject = reject
    } )

    var authed = false
    singleton.authdigest( this.req, this.res, () => { this.authresolve() } )
    return p
  }

  /* Private - called by us */
  _onauth( req, res ) {

    this.req = req
    this.res = res

    this.req.on( "cancel", () => this._oncanceled() )

    /* are we waiting for an auth ?*/
    if( undefined !== this.authresolve ) {
      consolelog( this, "checking auth" )
      let authed = false
      singleton.authdigest( this.req, this.res, () => { authed = true } )

      if( authed ) {
        consolelog( this, "resolving auth" )
        this.authresolve()

        consolelog( this, "cleaning up auth" )
        delete this.authresolve
        delete this.authreject
      }
    }
  }

  _oncanceled( req, res ) {
    consolelog( "client canceled" )
    this.canceled = true

    if( false !== this.parent && 1 === this.parent.children.length ) {
      this.parent.hangup()
    }

    this.children.forEach( ( child ) => {
      child.hangup()
    } )
  }

  ring() {
    if( !this.ringing && "uas" === this.type ) {
      this.ringing = true
      this.res.send( 180 )
    }
  }

  busy() {
    this.hangup( hangup_codes.USER_BUSY )
  }

  /*
    answer - returns promise.
    Answer the call and store a channel which can be used.
  */
  answer( options = {} ) {
    var p = new Promise( ( resolve, reject ) => {
      this.answerresolve = resolve
      this.answerreject = reject
    } )

    if( this.canceled ) {
      this.answerreject()
      return
    }

    this.sdp.remote = sdpgen.create( this.req.msg.body )

    if( undefined !== options.preferedcodecs ) {
      this.selectedcodec = this.sdp.remote.intersection( options.preferedcodecs, true )
      if( false === this.selectedcodec ) {
        this.selectedcodec = this.sdp.remote.intersection( singleton.options.preferedcodecs, true )
      }
    } else {
      this.selectedcodec = this.sdp.remote.intersection( singleton.options.preferedcodecs, true )
    }

    consolelog( this, "answer call with codec " + this.selectedcodec )

    rtp.channel( this.sdp.remote.select( this.selectedcodec ) )
      .then( ch => {

        this.chs.push( ch )
        this.sdp.local = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )

        if( this.canceled ) {
          this.answerreject()
          this.hangup()
          return
        }

        singleton.options.srf.createUAS( this.req, this.res, {
          localSdp: this.sdp.local.toString()
        } )
        .then( ( dialog ) => {
          this.established = true
          this.dialog = dialog
          this.addevents( this.dialog )
          this.answerresolve()

          this.addevents( this.dialog )
        } )
        .catch( ( err ) => { this.answerreject() } )
      } )

    return p
  }

  addevents( dialog ) {
    dialog.on( "destroy", ( req ) => {
      if( this.destroyed ) return
      this._onhangup( "wire" )
    } )

    dialog.on( "hold", ( req ) => {

    } )

    dialog.on( "unhold", ( req ) => {

    } )

    dialog.on( "refer", ( req, res ) => {

    } )

    dialog.on( "modify", ( req, res ) => {
      //  The application must respond, using the res parameter provided.
    } )
  }

  channels( cb ) {
    this.chs.forEach( ( ch ) => cb( ch ) )
    return this
  }

  /* TODO suport other types by searching for audio in channels list */
  get audio() {
    if( this.chs.length > 0 ) {
      return this.chs[ 0 ]
    }
    return
  }

  /* When our dialog has confirmed we have hung up */
  _onhangup( src = "us", reason ) {

    if( this.destroyed ) return
    consolelog( this, "on hangup from " + src )

    this.established = false
    this.destroyed = true

    this.channels( ( ch ) => ch.destroy() )
    this.chs = []

    if( undefined !== this.source_address ) {
      singleton.calls[ this.source_address ].delete( this.sip.callid )
      if( 0 === singleton.calls[ this.source_address ].size ) {
        singleton.calls.delete( this.source_address )
      }
    }

    if( false !== this.parent && 1 === this.parent.children.length ) {
      this.parent.hangup( reason )
    }

    this.children.forEach( ( child ) => {
      child.hangup( reason )
    } )
  }

  hangup( reason ) {

    if( this.destroyed ) {
      return
    }

    if( undefined === reason ) {
      reason = hangup_codes.NORMAL_CLEARING
    }
    /* If the call doesn't indicate a valid reason, then indicate ERROR */
    else if( undefined === hangup_codes[ reason ] ) {
      reason = hangup_codes.SERVER_ERROR
    }

    consolelog( this, "hanging up call by request with the reason " + reason.reason + ", SIP: " + reason.sip )

    if( this.established ) {
      this.dialog.destroy()
    } else if( "uac" === this.type ) {
      this.req.cancel()
    } else {
      this.res.send( reason.sip )
    }

    this._onhangup( reason )
  }

  /*
  destination can be
  1000
  1000@bling.babblevoice.com
  sip:1000@bling.babblevoice.com
  */
  parsedestination( destination ) {
    if( "sip:" !== destination.substring( 0, 4 ) ) {
      destination = "sip:" + destination
    }

    if( -1 === str.indexOf( "@" ) ) {
      destination = destination + "@" + this.req.authorization.realm
    }
  }

}

function consolelog( c, data ) {
  if( singleton.options.debug ) {
    console.log( c.uuid + ": " + data )
  }
}

/*
Not fully complete - but covers all we need.
*/
const hangup_codes = {
  UNALLOCATED_NUMBER: { "reason": "UNALLOCATED_NUMBER", "sip": 404 },
  USER_BUSY: { "reason": "USER_BUSY", "sip": 406 },
  NO_USER_RESPONSE: { "reason": "NO_USER_RESPONSE", "sip": 408 }, /* Timeout */
  NO_ANSWER: { "reason": "NO_ANSWER", "sip": 480 }, /* Temporarily Unavailable */
  LOOP_DETECTED: { "reason": "LOOP_DETECTED", "sip": 482 },
  INVALID_NUMBER_FORMAT: { "reason": "INVALID_NUMBER_FORMAT", "sip": 484 },
  USER_BUSY: { "reason": "USER_BUSY", "sip": 486 },
  NORMAL_CLEARING: { "reason": "NORMAL_CLEARING", "sip": 487 },
  REQUEST_TERMINATED: { "reason": "REQUEST_TERMINATED", "sip": 487 },
  INCOMPATIBLE_DESTINATION: { "reason": "INCOMPATIBLE_DESTINATION", "sip": 488 },
  SERVER_ERROR: { "reason": "SERVER_ERROR", "sip": 500 },
  FACILITY_REJECTED: { "reason": "FACILITY_REJECTED", "sip": 501 },
  DESTINATION_OUT_OF_ORDER: { "reason": "DESTINATION_OUT_OF_ORDER", "sip": 502 },
  CALL_REJECTED: { "reason": "CALL_REJECTED", "sip": 603 }
}

var singleton
class callmanager {
  constructor( options ) {
    singleton = this

    this.options = {
      "preferedcodecs": "pcmu pcma 2833",
      "transcode": true,
      "debug": false
    }

    this.options = { ...this.options, ...options }

    this.authdigest = digestauth( {
      proxy: true, /* 407 or 401 */
      passwordLookup: options.passwordLookup
    } )

    this.options.srf.use( "invite", this.oninvite )

    this.em = new events.EventEmitter()

    /* Track inbound calls. Outbound calls are not stored here */
    this.calls = new Map()
  }

  on( event, cb ) {
    this.em.on( event, cb )
  }

  get hangup_codes() {
    return hangup_codes
  }

  oninvite( req, res, next ) {

    if( req.method !== "INVITE" ) return next()

    /* Store the call by source address AND call id to prevent any possible (unlikely) clashing */
    if( undefined === singleton.calls[ req.source_address ] ) {
      singleton.calls[ req.source_address ] = new Map()
    }

    /* If we don't know about this call, store it then alert our dial plan */
    if( undefined === singleton.calls[ req.source_address ][ req.msg.headers[ "call-id" ] ] ) {
      let c = new call( req, res )
      singleton.calls[ req.source_address ][ req.msg.headers[ "call-id" ] ] = c
      singleton.em.emit( "call", c )
    } else {
      /* existing call... */
      let c = singleton.calls[ req.source_address ][ req.msg.headers[ "call-id" ] ]
      c._onauth( req, res )
    }

    return next()
  }
}

module.exports = callmanager
