
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

const default_options = {
  "preferedcodecs": "g722 ilbc pcmu pcma",
  "transcode": true,
  "debug": false,
  "uactimeout": 30000,
  "rfc2833": true
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


const eventdefs = [ "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "#", "A", "B", "C", "D" ]

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
    this.channels = []

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

    this.receivedtelevents = ""

    this.authresolve = false
    this.authreject = false
    this.authtimout = false

    this.waitforeventstimer = false
    this.waitforeventsresolve = false
    this.waitforeventsreject = false

    this.newuactimer = false
    this.newuacresolve = false
    this.newuacreject = false

    this.answerresolve = false
    this.answerreject = false
  }

  newuac( contact, from ) {

    return new Promise( ( resolve, reject ) => {

      let newcall = new call()
      newcall.type = "uac"
      newcall.parent = this
      newcall.newuacresolve = resolve
      newcall.newuacreject = reject
      this.children.push( newcall )

      newcall.newuactimer = setTimeout( () => {
        newcall.hangup( hangup_codes.NO_USER_RESPONSE )
        newcall.newuacreject( newcall )

      }, singleton.options.uactimeout )

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

            if( true === newcall.canceled ) {
              newcall.newuacreject( newcall )
              newcall.hangup()
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
            newcall.newuacreject( newcall )
          } else {
            consolelog( this, err )
          }
        } )

    } )
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

    clearTimeout( this.newuactimer )
    this.newuactimer = false

    /* We now have 2 calls, we may need to answer the parent */
    /* We have this.dialog (srf dialog object) and this.sdp.remote (sdp object) */
    if( this.parent.established ) {
      this.selectedcodec = this.sdp.remote.intersection( singleton.options.preferedcodecs, true )
      consolelog( this, "remote codec chosen: " + this.selectedcodec )

      rtp.channel( this.sdp.remote.select( this.selectedcodec ) )
        .then( ch => {
          this.channels.push( ch )
          ch.on( "telephone-event", ( e ) => this._tevent( e ) )

          this.sdp.local = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )
          if( true === singleton.options.rfc2833 ) {
            this.sdp.local.addcodecs( "2833" )
          }

          this.dialog.ack( this.sdp.local.toString() )
            .then( ( dlg ) => {
              this.dialog = dlg
              this.addevents( this.dialog )
              this.audio.mix( this.parent.audio )
              this.newuacresolve( this )
            } )

          if( this.canceled ) {
            this.newuacreject( this )
            return
          }
        } )
        .catch( () => {
          this.newuacreject( this )
          return
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
                this.channels.push( ch )
                ch.on( "telephone-event", ( e ) => this._tevent( e ) )

                if( true === singleton.options.rfc2833 ) {
                  this.sdp.local.addcodecs( "2833" )
                }

                this.dialog.ack( this.sdp.local.toString() )
                  .then( ( dlg ) => {
                    this.dialog = dlg
                    this.addevents( this.dialog )
                    this.audio.mix( this.parent.audio )
                    this.newuacresolve( this )
                  } )
                  .catch( () => {
                    this.newuacreject( this )
                  } )
              } )
              .catch( () => {
                this.newuacreject( this )
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
    return new Promise( ( resolve, reject ) => {
      this.authresolve = resolve
      this.authreject = reject
      this.authtimout = setTimeout( () => {
        this.authreject()
        this.authresolve = false
        this.authreject = false
        this.authtimout = false

        this.hangup( hangup_codes.NO_USER_RESPONSE )

      }, 50000 )

      singleton.authdigest( this.req, this.res, () => {

        if( false !== this.authtimout ) clearTimeout( this.authtimout )

        this.authresolve()
        this.authresolve = false
        this.authreject = false
        this.authtimout = false
      } )
    } )
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
        if( false !== this.authtimout ) {
          clearTimeout( this.authtimout )
          this.authtimout = false
        }
        this.authresolve()

        this.authresolve = false
        this.authreject = false
      }
    }
  }

  _oncanceled( req, res ) {
    consolelog( "client canceled" )
    this.canceled = true

    this.children.forEach( ( child ) => {
      child.hangup()
    } )
  }

  _tevent( e ) {
    this.receivedtelevents += eventdefs[ e ]

    if( undefined !== this.eventmatch ) {
      let ourmatch = this.receivedtelevents.match( this.eventmatch )
      if( null !== ourmatch ) {

        if( false !== this.waitforeventsresolve ) {
          this.waitforeventsresolve( ourmatch[ 0 ] )
          this.waitforeventsresolve = false
          clearTimeout( this.waitforeventstimer )
        }
      }
    }
  }

  waitforevents( match = /[0-9A-D\*#]/, timeout = 30000 ) {

    return new Promise( ( resolve, reject ) => {

      this.waitforeventstimer = setTimeout( () => {
        if( false === this.waitforeventsreject ) {
          this.waitforeventsreject()
          this.waitforeventsreject = false
          this.waitforeventsresolve = false
        }

      }, timeout )

      if( typeof match === "string" ){
        this.eventmatch = new RegExp( match )
      } else {
        this.eventmatch = match
      }

      /* All (previous) promises must be resolved */
      if( false !== this.waitforeventsreject ) {
        this.waitforeventsreject()
      }

      this.waitforeventsresolve = resolve
      this.waitforeventsreject = reject
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
    return new Promise( ( resolve, reject ) => {

      this.answerresolve = resolve
      this.answerreject = reject

      if( this.canceled ) {
        this.answerreject()
        return
      }

      options = { ...options, ...this.options, ...singleton.options }

      this.sdp.remote = sdpgen.create( this.req.msg.body )

      /* options.preferedcodecs may have been narrowed down so we still check singleton as well */
      this.selectedcodec = this.sdp.remote.intersection( options.preferedcodecs, true )
      if( false === this.selectedcodec ) {
        this.selectedcodec = this.sdp.remote.intersection( singleton.options.preferedcodecs, true )
      }

      consolelog( this, "answer call with codec " + this.selectedcodec )

      rtp.channel( this.sdp.remote.select( this.selectedcodec ) )
        .then( ch => {

          this.channels.push( ch )
          this.sdp.local = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )
          ch.on( "telephone-event", ( e ) => this._tevent( e ) )

          if( this.canceled ) {
            this.answerreject()
            return
          }

          if( true === singleton.options.rfc2833 ) {
            this.sdp.local.addcodecs( "2833" )
            ch.rfc2833( 101 )
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
        } ).catch( ( err ) => {
          this.answerreject()
        } )
    } )
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

  /* TODO suport other types by searching for audio in channels list */
  get audio() {
    if( this.channels.length > 0 ) {
      return this.channels[ 0 ]
    }
    return
  }

  /* When our dialog has confirmed we have hung up */
  _onhangup( src = "us", reason ) {

    if( this.destroyed ) return
    consolelog( this, "on hangup from " + src )

    let wasestablished = this.established

    this.established = false
    this.destroyed = true

    if( undefined !== this.newuactimer ) clearTimeout( this.newuactimer )
    if( undefined !== this.authtimout ) {
      clearTimeout( this.authtimout )
      this.authtimout = false
    }

    this.channels.forEach( ( ch ) => ch.destroy() )
    this.channels = []

    if( undefined !== this.source_address ) {
      singleton.calls[ this.source_address ].delete( this.sip.callid )
      if( 0 === singleton.calls[ this.source_address ].size ) {
        singleton.calls.delete( this.source_address )
      }
    }

    if( false !== this.parent && true === wasestablished ) {
      this.parent.hangup( reason )
    }

    this.children.forEach( ( child ) => {
      child.hangup( reason )
    } )
  }

  hangup( reason ) {

    if( this.destroyed ) return

    if( undefined === reason ) {
      reason = hangup_codes.NORMAL_CLEARING
    }

    this.hangup_cause = reason

    consolelog( this, "hanging up call by request with the reason " + reason.reason + ", SIP: " + reason.sip )

    if( this.established ) {
      this.dialog.destroy()
    } else if( "uac" === this.type ) {
      if( undefined !== this.req ) {
        this.req.cancel()
      } else {
        /* hanging up has been delayed */
        this.canceled = true
        return
      }

    } else {
      this.res.send( reason.sip )
    }

    this._onhangup( "us", reason )
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

var singleton
class callmanager {
  /*
  options supplied can also be provided in a call object or be provided to functions like answer
  all 3 objects are joined the the function, call, callmanager (in that order) being used.
  */
  constructor( options ) {
    singleton = this

    this.options = { ...default_options, ...options }

    this.authdigest = digestauth( {
      "proxy": true, /* 407 or 401 */
      "passwordLookup": options.passwordLookup
    } )

    this.options.srf.use( "invite", this.oninvite )

    this.em = new events.EventEmitter()
    this.em.on( "call", ( c ) => {

      if( false !== this.onnewcall ) {


        this.onnewcall( c )
          .catch( ( err ) => {
            try{
              console.error( err )
              if( false === c.destroyed ) {
                consolelog( c, "Unhandled exception - hanging up" )
                c.hangup( hangup_codes.SERVER_ERROR )
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
      this.em.on( event, cb )
    }
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
