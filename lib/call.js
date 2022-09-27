
const { v4: uuidv4 } = require( "uuid" )
const events = require( "events" )
const dns = require( "node:dns" )

const projectrtp = require( "@babblevoice/projectrtp" ).projectrtp

const parseuri = require( "drachtio-srf" ).parseUri
const sdpgen = require( "./sdp.js" )
const callstore = require( "./store.js" )

const sipauth = require( "@babblevoice/babble-drachtio-auth" )

/*
Enum for different reasons for hangup.
*/
const hangupcodes = {
  /* Client error responses */
  PAYMENT_REQUIRED: { "reason": "PAYMENT_REQUIRED", "sip": 402 },
  FORBIDDEN: { "reason": "FORBIDDEN", "sip": 403 },
  OUTGOING_CALL_BARRED: { "reason": "OUTGOING_CALL_BARRED", "sip": 403 },
  INCOMING_CALL_BARRED: { "reason": "INCOMING_CALL_BARRED", "sip": 403 },
  UNALLOCATED_NUMBER: { "reason": "UNALLOCATED_NUMBER", "sip": 404 },
  NOT_ALLOWED: { "reason": "NOT_ALLOWED", "sip": 405 },
  NOT_ACCEPTABLE: { "reason": "NOT_ACCEPTABLE", "sip": 406 },
  PROXY_AUTHENTICATION: { "reason": "PROXY_AUTHENTICATION", "sip": 407 },
  REQUEST_TIMEOUT: { "reason": "REQUEST_TIMEOUT", "sip": 408 },
  USER_GONE: { "reason": "USER_GONE", "sip": 410 },
  TEMPORARILY_UNAVAILABLE: { "reason": "TEMPORARILY_UNAVAILABLE", "sip": 480 },
  CALL_DOES_NOT_EXIST: { "reason": "CALL_DOES_NOT_EXIST", "sip": 481 },
  LOOP_DETECTED: { "reason": "LOOP_DETECTED", "sip": 482 },
  TOO_MANY_HOPS: { "reason": "TOO_MANY_HOPS", "sip": 483 },
  INVALID_NUMBER_FORMAT: { "reason": "INVALID_NUMBER_FORMAT", "sip": 484 },
  AMBIGUOUS: { "reason": "AMBIGUOUS", "sip": 485 },
  USER_BUSY: { "reason": "USER_BUSY", "sip": 486 },
  NORMAL_CLEARING: { "reason": "NORMAL_CLEARING", "sip": 487 },
  ORIGINATOR_CANCEL: { "reason": "ORIGINATOR_CANCEL", "sip": 487 },
  USER_NOT_REGISTERED: { "reason": "USER_NOT_REGISTERED", "sip": 487 },
  BLIND_TRANSFER: { "reason": "BLIND_TRANSFER", "sip": 487 },
  ATTENDED_TRANSFER: { "reason": "ATTENDED_TRANSFER", "sip": 487 },
  LOSE_RACE: { "reason": "LOSE_RACE", "sip": 487 },
  PICKED_OFF: { "reason": "PICKED_OFF", "sip": 487 },
  MANAGER_REQUEST: { "reason": "MANAGER_REQUEST", "sip": 487 },
  REQUEST_TERMINATED: { "reason": "REQUEST_TERMINATED", "sip": 487 },
  INCOMPATIBLE_DESTINATION: { "reason": "INCOMPATIBLE_DESTINATION", "sip": 488 },
  /* Server error responses */
  SERVER_ERROR: { "reason": "SERVER_ERROR", "sip": 500 },
  FACILITY_REJECTED: { "reason": "FACILITY_REJECTED", "sip": 501 },
  DESTINATION_OUT_OF_ORDER: { "reason": "DESTINATION_OUT_OF_ORDER", "sip": 502 },
  SERVICE_UNAVAILABLE: { "reason": "SERVICE_UNAVAILABLE", "sip": 503 },
  SERVER_TIMEOUT: { "reason": "SERVER_TIMEOUT", "sip": 504 },
  MESSAGE_TOO_LARGE: { "reason": "MESSAGE_TOO_LARGE", "sip": 513 },
  /* Global error responses */
  BUSY_EVERYWHERE: { "reason": "BUSY_EVERYWHERE", "sip": 600 },
  DECLINED: { "reason": "DECLINED", "sip": 603 },
  DOES_NOT_EXIST_ANYWHERE: { "reason": "DOES_NOT_EXIST_ANYWHERE", "sip": 604 },
  UNWANTED: { "reason": "UNWANTED", "sip": 607 },
  REJECTED: { "reason": "REJECTED", "sip": 608 }
}

/* Reverse codes - include inbound error codes.
If not in this list we return REQUEST_TERMINATED during creation */
const inboundsiperros = {
  486: hangupcodes.USER_BUSY,
  408: hangupcodes.REQUEST_TIMEOUT,
  404: hangupcodes.UNALLOCATED_NUMBER
}

var callmanager = {
  "options": {}
}

/** @class */
class call {

  /**
  Construct our call object with all defaults, including a default UUID.
  @constructs call
  @hideconstructor
  */
  constructor() {
    this.uuid = uuidv4()

    /**
    @enum {string} type "uas" | "uac"
    @summary The type (uac or uas) from our perspective.
    */
    this.type = "uac"

    /**
      @typedef { Object } callstate
      @property { boolean } trying
      @property { boolean } early
      @property { boolean } ringing
      @property { boolean } established
      @property { boolean } canceled
      @property { boolean } destroyed
      @property { boolean } held
      @property { boolean } authed
      @property { boolean } cleaned
      @property { boolean } refered
    */

    /** @member { callstate } */
    this.state = {
      "trying": false,
      "early": false,
      "ringing": false,
      "established": false,
      "canceled": false,
      "destroyed": false,
      "held": false,
      "authed": false,
      "cleaned": false,
      "refered": false
    }

    /**
     * @private
     */
    this._state = {
      "_onhangup": false,
      "_hangup": false
    }

    /**
    @member
    @summary Channels which have been created
    */
    this.channels = {
      "audio": false,
      "closed": {
        "audio": []
      }
    }

    /**
    @member
    @summary Store our local and remote sdp objects
    */
    this.sdp = {
      "local": false,
      "remote": false
    }

    /**
    @member
    @summary UACs we create
    */
    this.children = new Set()
    /**
    @member
    @summary Who created us
    */
    this.parent = false

    /**
      @typedef {Object} epochs
      @property {number} startat UNIX timestamp of when the call was started (created)
      @property {number} answerat UNIX timestamp of when the call was answered
      @property {number} endat UNIX timestamp of when the call ended
    */

    /** @member {epochs} */
    this.epochs = {
      "startat": Math.floor( +new Date() / 1000 ),
      "answerat": 0,
      "endat": 0,
      "mix": 0
    }

    /**
      @typedef {Object} sipdialog
      @property {object} tags
      @property {string} tags.local
      @property {string} tags.remote
    */
    /** @member {sipdialog} */
    this.sip = {
      "tags": {
        "remote": "",
        "local": ""
      }
    }

    /**
    @typedef { Object } entity
    @property { string } [ username ] username part
    @property { string } [ realm ] realm (domain) part
    @property { string } [ uri ] full uri
    @property { string } [ display ] how the user should be displayed
    */
    /**
    For inbound calls - this is discovered by authentication. For outbound
    this is requested by the caller - i.e. the destination is the registered user.
    @member { _entity }
    @private
    */
    this._entity

    /**
    Override caller id or name.
    @member { _remote }
    @private
    */
    this._remote = {
      "id": false,
      "name": false
    }

    /**
     * @member { object }
     * @summary contains network information regarding call
     */
    this.network = {
      "remote": {
        "address": "",
        "port": 0,
        "protocol": ""
      }
    }

    /**
    @member {object}
    @summary user definable object that allows other modules to store data in this call.
    */
    this.vars = {}

    /**
    @member {string}
    @private
    */
    this._receivedtelevents = ""

    /**
    @member {object}
    @private
    */
    this._promises = {
      "resolve": {
        "auth": false,
        "hangup": false,
        "events": false,
        "channelevent": false
      },
      "reject": {
        "auth": false
      },
      "promise": {
        "hangup": false,
        "events": false,
        "channelevent": false
      }
    }

    this._promises.promise.hangup = new Promise( ( r ) => {
      this._promises.resolve.hangup = r
    } )

    /**
    @member {object}
    @private
    */
    this._timers = {
      "auth": false,
      "newuac": false,
      "events": false,
      "seinterval": false,
      "anyevent": false
    }

    /**
    @member {object}
    @private
    */
    this._em = new events.EventEmitter()

    /**
    @member
    @private
    */
    this._auth = sipauth.create( callmanager.options.proxy )

    this.referauthrequired = callmanager.options.referauthrequired

    /**
    Enable access for other modules.
    */
    this.hangupcodes = hangupcodes
  }

  /**
  @typedef entity
  @property { string } username
  @property { string } realm
  @property { string } uri
  @property { string } display
  @property { number } ccc - Current Call Count
  */

  /**
  Returns the entity if known (i.e. outbound or inbound authed).
  @returns { Promise< entity > }
  */
  get entity() {

    return ( async () => {
      if( !this._entity ) return

      if( !this._entity.username && this._entity.uri ) {
        this._entity.username = this._entity.uri.split( "@" )[ 0 ]
      }
  
      if( !this._entity.realm && this._entity.uri ) {
        let uriparts = this._entity.uri.split( "@" )
        if( uriparts.length > 1 )
        this._entity.realm = uriparts[ 1 ]
      }
  
      if( !this._entity.uri && this._entity.username && this._entity.realm ) {
        this._entity.uri = this._entity.username + "@" + this._entity.realm
      }
  
      let entitycalls = await callstore.getbyentity( this._entity.uri )
      let entitycallcount = 0
      if( false !== entitycalls ) entitycallcount = entitycalls.size
  
      return {
        "username": this._entity.username,
        "realm": this._entity.realm,
        "uri": this._entity.uri,
        "display": this._entity.display?this._entity.display:"",
        "ccc": entitycallcount
      }
    } )()
  }

  /**
  @typedef remoteid
  @property { string } host
  @property { string } user
  @property { string } name
  @property { string } uri
  @property { boolean } privacy
  @property { string } type - "callerid" | "calledid"
  */

  /**
  @typedef callerid
  @property { string } id
  @property { string } name
  */

  /**
   * Sets caller id name or id
   * @param { callerid } rem
   */
  set remote( rem ) {

    for( const key in this._remote ) {
      if( rem[ key ] in rem ) {
        this._remote[ key ] = rem[ key ]
      }
    }
  }

  /**
  Returns the caller or called id, number, name and domains + privacy if set.
  @returns { remoteid } remoteid
  */
  get remote() {

    switch( this.type ) {
      case "uac": {

        /* "Display Name" <sip:0123456789@bling.babblevoice.com>;party=calling;screen=yes;privacy=off */
        if( this._entity ) {
          return {
            "name": this._entity.display,
            "uri": this._entity.uri,
            "user": this._entity.username,
            "host": this._entity.realm,
            "privacy": false,
            "type": "calledid"
          }
        }

        if( this.options && this.options.contact ) {
          let parseduri = parseuri( this.options.contact )
          return {
            "name": "",
            "uri": this.options.contact,
            "user": parseduri.user,
            "host": parseduri.host,
            "privacy": false,
            "type": "calledid"
          }
        }

        /* we shouldn't get here */
        return {
          "name": "",
          "uri": "",
          "user": "0000000000",
          "host": "localhost.localdomain",
          "privacy": false,
          "type": "calledid"
        }
      }
      default: {
        /* uas - inbound */
        let parsed
        if( this._entity ) {
          return {
            "name": this._remote.name?this._remote.name:(this._entity.display),
            "uri": this._entity.uri,
            "user": this._remote.id?this._remote.id:(this._entity.username),
            "host": this._entity.realm,
            "privacy": false,
            "type": "callerid"
          }
        } else if( this._req.has( "p-asserted-identity" ) ) {
          parsed = this._req.getParsedHeader( "p-asserted-identity" )
        } else if( this._req.has( "remote-party-id" ) ) {
          parsed = this._req.getParsedHeader( "remote-party-id" )
        } else {
          parsed = this._req.getParsedHeader( "from" )
        }

        if( !parsed ) parsed = {}
        let parseduri = parseuri( parsed.uri )
        if( !parsed.params ) parsed.params = {}

        return {
          "name": this._remote.name?this._remote.name:( !parsed.name?"":parsed.name.replace( /['"]+/g, "" ) ),
          "uri": parsed.uri,
          "user": this._remote.id?this._remote.id:(parseduri.user),
          "host": parseduri.host,
          "privacy": parsed.params.privacy === "true",
          "type": "callerid"
        }
      }
    }
  }

  /**
  @typedef destination
  @property { string } host
  @property { string } user
  */

  /**
  Return the destination of the call.
  @return { destination }  destination - parsed uri
  */
  get destination() {
    if( undefined !== this.referingtouri ) {
      return parseuri( this.referingtouri )
    }

    if( "uac" == this.type ) {
      if( Array.isArray( this.sip.contact ) ) {
        return parseuri( this.sip.contact[ 0 ].uri )
      }
      return parseuri( this.options.contact )
    }

    return parseuri( this._req.msg.uri )
  }

  /*
  State functions
  Get state as a string
  According to state machine in RFC 4235, we send early if we have received a 1xx with tag
  I am going to use 100 and 180 - which should be the same.
  */

  /**
    hasmedia
    @return {bool} - true if the call has media (i.e. is established on not held).
  */
  get hasmedia() {
    if( this.state.held ) return false
    return true == this.state.established
  }

  /**
    trying
    @return {bool} - true if the call has been trying.
  */
  set trying( s ) {
    if( this.state.trying != s ) {
      this.state.trying = s
    }
  }

  /**
    trying
    @return {bool} - true if the call has been trying.
  */
  get trying() {
    return this.state.trying
  }

  /**
    ringing
    @return {bool} - true if the call has been ringing.
  */
  get ringing() {
    return this.state.ringing
  }

  /**
   * @param { boolean } r - the new state
   */
  set ringing( r ) {
    this.state.ringing = r 
  }

  /**
    established - if the call isn't already established then set the answerat time.
    @param {bool} s - true if the call has been established.
  */
  set established( s ) {
    if( this.state.established != s ) {
      this.epochs.answerat = Math.floor( +new Date() / 1000 )
      this.state.established = s
    }
  }

  /**
    established
    @return {bool} - true if the call has been established.
  */
  get established() {
    return this.state.established
  }

  /**
    @summary canceled - if the call isn't already canceled then set the endat time.
    @type {boolean}
  */
  set canceled( s ) {
    if( this.state.canceled != s ) {
      this.epochs.endat = Math.floor( +new Date() / 1000 )
      this.state.canceled = s
    }
  }

  /**
    @summary is the call canceled
    @return {boolean} - true if the call has been canceled.
  */
  get canceled() {
    return true == this.state.canceled
  }

  /**
    destroyed - if the call isn't already desroyed then set the endat time.
    @param {bool} s - true if the call has been destroyed.
  */
  set destroyed( s ) {
    if( this.state.destroyed != s ) {
      this.epochs.endat = Math.floor( +new Date() / 1000 )
      this.state.destroyed = s
    }
  }

  /**
    destroyed
    @return {bool} - true if teh call has been destroyed.
  */
  get destroyed() {
    return true == this.state.destroyed
  }

  /**
    @summary the current state of the call as a string: trying|proceeding|early|confirmed|terminated
    @return {string}
  */
  get statestr() {
    if( this.state.established ) {
      return "confirmed"
    }

    if( this.state.ringing ) {
      return "early"
    }

    if( this.state.trying ) {
      return "proceeding"
    }

    if( this.state.destroyed ) {
      return "terminated"
    }

    return "trying"
  }

  /**
    duration
    @return {number} - the number of seconds between now (or endat if ended) and the time the call was started.
  */
  get duration() {
    if( 0 !== this.epochs.endat ) return parseInt( this.epochs.endat - this.epochs.startat )
    return parseInt( Math.floor( +new Date() / 1000 ) - this.epochs.startat )
  }

  /**
    Get the estrablished time.
    @return {number} - the number of seconds between now (or endat if ended) and the time the call was answered.
  */
  get billingduration() {
    if( 0 === this.epochs.answerat ) return 0
    if( 0 !== this.epochs.endat ) return parseInt( this.epochs.endat - this.epochs.answerat )
    return parseInt( Math.floor( +new Date() / 1000 ) - this.epochs.answerat )
  }

  /**
    Callback for events we pass back to inerested parties.
    @callback call.event
    @param {object} call - we pass *this back into the requester
  */

  /**
    Registers an event callback for this specific call. An event sink registered
    on this member will receive events only for this call. We emit on call specific
    emitter and a global emitter.
    @param { string } ev - The contact string for registered or other sip contact
    @param { call.event } cb
  */
  on( ev, cb ) {
    this._em.on( ev, cb )
  }

  /**
    See event emitter once
    @param { string } ev - The contact string for registered or other sip contact
    @param { call.event } cb
  */
  once( ev, cb ) {
    this._em.once( ev, cb )
  }

  /**
    See event emitter off
    @param { string } ev - The contact string for registered or other sip contact
    @param { call.event } cb
  */
  off( ev, cb ) {
    if( !cb ) {
      this._em.removeAllListeners( ev )
      return
    }
    
    this._em.off( ev, cb )
  }

  /**
    See event emitter removeAllListeners
    @param { string } ev - The contact string for registered or other sip contact
  */
  removealllisteners( ev ) {
    if( !ev ) {
      let evnames = this._em.eventNames()
      for( let evname of evnames ) {
        this._em.removeAllListeners( evname )
      }
    } else {
      this._em.removeAllListeners( ev )
    }
  }

  /**
    See event emitter setMaxListeners
    @param { number } n
  */
  setmaxlisteners( n ) {
    this._em.setMaxListeners( n )
  }

  /**
    Allows 3rd parties to emit events to listeners specific to this call.
    @param { string } ev - event name
  */
  emit( ev ) {
    this._em.emit( ev, this )
  }

  /**
  Call creation event.
  @event call.new
  @type {call}
  */

  /**
  Emitted when a call is ringing
  @event call.ringing
  @type {call}
  */

    /**
  Emitted when a call is receives early
  @event call.early
  @type {call}
  */

  /**
  Emitted when a call is answered
  @event call.answered
  @type {call}
  */

  /**
  Emitted when a call is mixed with another call (not after unhold as this has it's own event)
  @event call.mix
  @type {call}
  */

  /**
  Emitted when a call is authed
  @event call.authed
  @type {call}
  */

  /**
  Emitted when a call auth fails
  @event call.authed.failed
  @type {call}
  */

  /**
  Emitted when a call is placed on hold
  @event call.hold
  @type {call}
  */

  /**
  Emitted when a call is taken off hold
  @event call.unhold
  @type {call}
  */

  /**
  Emitted when a call is destroyed
  @event call.destroyed
  @type {call}
  */
 
  /**
  Emitted immediatly called after call.destroyed
  @event call.reporting
  @type {call}
  */

  /**
  Emitted immediatly before a call is picked
  @event call.pick
  @type {call}
  */

  /**
  Emits the event call.pick to allow other parts of dial plan to give up on further processing.
  It wuld be normal to bridge this call to another after this call has been made.
  */
  pick() {
    this._em.emit( "call.pick", this )
  }

  /**
    Delink calls logically - any calls which have parent or children they are all removed.
    when the dialog is either answered (or doesn't answer for some reason).
    The promise resolves to a new call is one is generated, or undefined if not.
  */
  detach() {
    if( this.parent ) {
      this.parent.children.delete( this )
    }

    for( let child of this.children ) {
      child.parent = false
    }

    this.parent = false
    this.children.clear()
  }

  /**
  Logically adopt a child call
  @param { call } other 
  */
  adopt( other, mix ) {
    other.parent = this
    this.children.add( other )

    if( mix ) {
      this.channels.audio.mix( other.channels.audio )

      this._em.emit( "call.mix", this )
      callmanager.options.em.emit( "call.mix", this )
      other._em.emit( "call.mix", other )
      callmanager.options.em.emit( "call.mix", other )

      this.epochs.mix = Math.floor( +new Date() / 1000 )
      other.epochs.mix = Math.floor( +new Date() / 1000 )
    }
  }

  /**
    Called from newuac when we receive a 180
    @private
  */
  _onring() {
    if( this.state.ringing ) return
    this.state.ringing = true
    if( false !== this.parent ) {
      this.parent.ring()
    }

    this._em.emit( "call.ringing", this )
    callmanager.options.em.emit( "call.ringing", this )
  }

  /**
    Called from newuac when we receive a 183
    @private
  */
  async _onearly() {

    if( this.state.established ) return
    if( !this._res || !this._res.msg || !this._res.msg.body ) return

    /* we have this._res */
    this.sdp.remote = sdpgen.create( this._res.msg.body )
    await this.answer( { "early": true } )

    if( !this.parent || this.parent.state.established ) return

    await this.parent.answer( { "early": true } )
    await this.channels.audio.mix( this.parent.channels.audio )

    this.parent._res.send( 183, {
      headers: {
          "User-Agent": "project",
          "Supported": "replaces"
        },
        "body": this.parent.sdp.local.toString()
    } )
  }

  /**
    Called from newuac when we are answered and we have a dialog,
    this = child call (the new call - the bleg)
    @private
  */
  async _onanswer() {

    let hangups = []
    if( this.parent ) {
      for( let child of this.parent.children ) {
        if( child.uuid !== this.uuid ) {
          child.detach()
          /* do not await - we do not want to delay the winner in 
          connecting by waiting for the completion of the hangups */
          hangups.push( child.hangup( hangupcodes.LOSE_RACE ) )
        }
      }
    }

    if( this.state.destroyed ) return this
    callstore.set( this )

    if( true === this.options.noAck ) {
      await this._onlatebridge()
    } else {
      await this._onearlybridge()
    }

    this.established = true
    this.sip.tags.remote = this._dialog.sip.remoteTag

    let r = this._promises.resolve.newuac
    this._promises.resolve.newuac = false
    this._promises.reject.newuac = false

    if( hangups.length > 0 ) {
      await Promise.all( hangups )
    }

    if( r ) r( this )
    return this
  }

  /* A simple implimentation if we are offered candidates */
  static async _parsesdpcandidates( target, sdp ) {

    if( Array.isArray( sdp.media[ 0 ].candidates ) ) {
      let candidates = sdp.media[ 0 ].candidates
      if( candidates.length > 0 ) {
        candidates.sort( ( l, r ) => { return r.priority - l.priority } )
        target.port = candidates[ 0 ].port

        await new Promise( ( r ) => {
          dns.lookup( candidates[ 0 ].ip, ( err, result ) => {
            if( !err ) target.address = result
            r()
          } )
        } )
      }
    }
  }

  /**
    On an early negotiation we have already sent our sdp without
    knowing what the otherside is going to offer. We now have the
    other sides SDP so we can work out the first common CODEC.
    this = child call (the new call - the bleg)
    @private
  */
  async _onearlybridge() {
    if( this.destroyed ) return

    this._addevents( this._dialog )

    this.sdp.remote = sdpgen.create( this._dialog.remote.sdp )
    this.selectedcodec = this.sdp.remote.intersection( this.options.preferedcodecs, true )
    if( "" == this.selectedcodec ) {
      return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )
    }

    let target = this.sdp.remote.getaudio()
    if( !target ) return

    let channeldef
    if( this._iswebrtc ) {
      let actpass = "active"
      if( "active" == this.sdp.remote.sdp.media[ 0 ].setup ) actpass = "passive" /* act|pass|actpass */

      await call._parsesdpcandidates( target, this.sdp.remote.sdp )

      channeldef = call._createchannelremotedef( 
                    target.address,
                    target.port,
                    target.audio.payloads[ 0 ],
                    this.sdp.remote.sdp.media[ 0 ].fingerprint.hash,
                    actpass ).remote
    } else {
      channeldef = call._createchannelremotedef( target.address, target.port, target.audio.payloads[ 0 ] ).remote
    }

    this.channels.audio.remote( channeldef )

    if( this.parent ) {
      if( !this.parent.established ) {
        await this.parent.answer( { "preferedcodecs": this.selectedcodec } )
          .catch( ( err ) => {
            console.trace( err )
          } )
  
        if( !this.parent.established ) {
          return this.hangup( hangupcodes.USER_GONE )
        }
      }
  
      this.channels.audio.mix( this.parent.channels.audio )

      this._em.emit( "call.mix", this )
      callmanager.options.em.emit( "call.mix", this )
      this.parent._em.emit( "call.mix", this.parent )
      callmanager.options.em.emit( "call.mix", this.parent )

      this.epochs.mix = Math.floor( +new Date() / 1000 )
      if( this.parent ) this.parent.epochs.mix = Math.floor( +new Date() / 1000 )
    }

    return this
  }

  /**
    Accept and bridge to calls with late negotiation.
    this = child call (the new call - the bleg)
    OR
    this = standalone call - no other legs
    @private
  */
  async _onlatebridge() {

    /* Calculate the best codec for both legs - find a common codec if possible
    if not - transcode */

    this.sdp.remote = sdpgen.create( this._req.msg.body )

    let alegremotesdp
    if( this.parent ) {
      if( this.parent.established ) {
        alegremotesdp = this.parent.sdp.remote
      } else {
        alegremotesdp = sdpgen.create( this.parent._req.msg.body )
      }

      this.selectedcodec = this.sdp.remote.intersection(
        alegremotesdp.intersection( this.options.preferedcodecs ), true )

      if( this.selectedcodec ) {
        this.parent.selectedcodec = this.selectedcodec
      } else {
        /* Ok - transcode */
        this.selectedcodec = this.sdp.remote.intersection( this.options.preferedcodecs, true )
        if( "" == this.selectedcodec || "" == this.parent.selectedcodec ) {
          return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )
        }
      }
    } else {
      /* no parent - just pick our prefered codec */
      this.selectedcodec = this.sdp.remote.intersection( this.options.preferedcodecs, true )
      if( "" == this.selectedcodec ) {
        return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )
      }
    }

    let target = this.sdp.remote.getaudio()
    if( !target ) return
    let channeldef 
    if( this._iswebrtc ) {
      let actpass = "active"
      if( "act" == this.sdp.remote.sdp.media[ 0 ].setup ) actpass = "passive" /* act|pass|actpass */

      channeldef = call._createchannelremotedef( 
              target.address, 
              target.port, 
              target.audio.payloads[ 0 ],
              this.sdp.remote.sdp.media[ 0 ].fingerprint.hash,
              actpass ) 
    } else {
      channeldef = call._createchannelremotedef( target.address, target.port, target.audio.payloads[ 0 ] ) 
    }
   
    this.channels.audio = await projectrtp.openchannel( channeldef, this._handlechannelevents.bind( this ) )

    this.sdp.local = sdpgen.create()
              .addcodecs( this.selectedcodec )
              .setconnectionaddress( this.channels.audio.local.address )
              .setaudioport( this.channels.audio.local.port )

    if( true === this.options.rfc2833 ) {
      this.sdp.local.addcodecs( "2833" )
    }

    if( this._iswebrtc ) {
      let ch = this.channels.audio
      this.sdp.local.addssrc( ch.local.ssrc )
                    .secure( ch.local.dtls.fingerprint, channeldef.remote.dtls.mode )
                    .addicecandidates( ch.local.address, ch.local.port, ch.local.icepwd )
                    .rtcpmux()
    }

    this._dialog = await this._dialog.ack( this.sdp.local.toString() )
    this._addevents( this._dialog )

    if( this.parent ) {
      if( !this.parent.established ) {
        await this.parent.answer( { "preferedcodecs": this.selectedcodec } )
          .catch( ( err ) => {
            console.trace( err )
          } )
  
        if( !this.parent.established ) {
          return this.hangup( hangupcodes.USER_GONE )
        }
      }
  
      this.channels.audio.mix( this.parent.channels.audio )

      this._em.emit( "call.mix", this )
      callmanager.options.em.emit( "call.mix", this )
      this.parent._em.emit( "call.mix", this.parent )
      callmanager.options.em.emit( "call.mix", this.parent )

      this.epochs.mix = Math.floor( +new Date() / 1000 )
      if( this.parent ) this.parent.epochs.mix = Math.floor( +new Date() / 1000 )
    }

    return this
  }

  /**
    Sometimes we don't care who if we are the parent or child - we just want the other party
    @return {object|bool} returns call object or if none false
  */
  get other() {
    if( this.parent ) return this.parent

    for( const child of this.children ) {
      if( child.established ) {
        return child
      }
    }

    if( this.children.length > 0 ) return this.children[ 0 ]

    return false
  }

  /**
    auth - returns promise. This will force a call to be authed by a client. If the call
    has been refered by another client that has been authed this call will assume that auth.
    @todo check refering call has been authed
    @return {Promise} Returns promise which resolves on success or rejects on failed auth. If not caught this framework will catch and cleanup.
  */
  auth() {
    return new Promise( async ( resolve, reject ) => {

      try {

        /* we have been requested to auth - so set our state to unauthed */
        this.state.authed = false

        this._promises.resolve.auth = resolve
        this._promises.reject.auth = reject

        this._timers.auth = setTimeout( () => {
          this._promises.reject.auth()
          this._promises.resolve.auth = false
          this._promises.reject.auth = false
          this._timers.auth = false

          this.hangup( hangupcodes.REQUEST_TIMEOUT )

        }, 50000 )

        if( this._auth.has( this._req ) ) {
          /* If the client has included an auth header check it immediatly */
          this._onauth( this._req, this._res )
          return
        }

        /* Fresh auth */
        this._auth = sipauth.create( callmanager.options.proxy )
        if( !this._auth.requestauth( this._req, this._res ) ) {

          /* requestauth can only fail if the request is poorly formated */
          await this.hangup( hangupcodes.NOT_ACCEPTABLE )

          this._promises.resolve.auth = false
          this._promises.reject.auth = false
          this._timers.auth = false

          if( this._timers.auth ) {
            clearTimeout( this._timers.auth )
            this._timers.auth = false
          }

          reject( this )
        }

      } catch( e ) {
        console.trace( e )
      }
    } )
  }

  /**
    Called by us we handle the auth challenge in this function
    @private
  */
  async _onauth( req, res ) {

    /* have we got an auth responce */
    if( !this._auth.has( req ) ) return

    this._req = req
    this._res = res

    if( this._req.msg && this._req.msg.body ) {
      this.sdp.remote = sdpgen.create( this._req.msg.body )
    }

    this._req.on( "cancel", () => this._oncanceled() )

    let authorization = this._auth.parseauthheaders( this._req )

    if( undefined === callmanager.options.userlookup ) { 
      this._promises.reject.auth( "no userlookup function provided")
      this._promises.resolve.auth = false
      this._promises.reject.auth = false
      return
    }
    
    let user = await callmanager.options.userlookup( authorization.username, authorization.realm )

    if( !user || !this._auth.verifyauth( this._req, authorization, user.secret ) ) {

      if( this._auth.stale ) {
        return this._auth.requestauth( this._req, this._res )
      }

      this._em.emit( "call.authed.failed", this )
      callmanager.options.em.emit( "call.authed.failed", this )

      await this.hangup( hangupcodes.FORBIDDEN )

      let r = this._promises.reject.auth
      this._promises.resolve.auth = false
      this._promises.reject.auth = false

      if( this._timers.auth ) clearTimeout( this._timers.auth )
      this._timers.auth = false

      if( r ) r()

      return
    }

    if( this.destroyed ) return

    if( this._timers.auth ) clearTimeout( this._timers.auth )
    this._timers.auth = false

    this._entity = {
      "username": authorization.username,
      "realm": authorization.realm,
      "uri": authorization.username + "@" + authorization.realm,
      "display": !user.display?"":user.display
    }

    this.state.authed = true

    callstore.set( this )

    let r = this._promises.resolve.auth
    this._promises.resolve.auth = false
    this._promises.reject.auth = false
    this._timers.auth = false
    if( r ) r()

    this._em.emit( "call.authed", this )
    callmanager.options.em.emit( "call.authed", this )

  }

  /**
    Called by us to handle call cancelled
    @private
  */
  _oncanceled( req, res ) {
    this.canceled = true

    for( let child of this.children ) {
      child.hangup()
    }

    this._onhangup( "wire", hangupcodes.ORIGINATOR_CANCEL )
  }

  /**
    Called by us to handle DTMF events. If it finds a match it resolves the Promise created by waitfortelevents.
    @private
  */
  _tevent( e ) {
    this._receivedtelevents += e

    if( undefined !== this.eventmatch ) {
      let ourmatch = this._receivedtelevents.match( this.eventmatch )
      if( null !== ourmatch ) {

        delete this.eventmatch
        this._receivedtelevents = this._receivedtelevents.slice( ourmatch[ 0 ].length + ourmatch.index )

        if( this._promises.resolve.events ) {
          let r = this._promises.resolve.events
          
          this._promises.resolve.events = false
          this._promises.promise.events = false
          r( ourmatch[ 0 ] )
        }

        if( this._timers.events ) {
          clearTimeout( this._timers.events )
          this._timers.events = false
        }
      }
    }
  }

  /**
    Called by our call plan to wait for events for auto attendant/IVR.
    @param {string} [match] - reg exp matching what is required from the user.
    @param {Int} [timeout] - time to wait before giving up.
    @return {Promise} - the promise either resolves to a string if it matches or undefined if it times out..
  */
  waitfortelevents( match = /[0-9A-D\*#]/, timeout = 30000 ) {

    if( this.destroyed ) throw "Call already destroyed"
    if( this._promises.promise.events ) return this._promises.promise.events

    this._promises.promise.events = new Promise( ( resolve ) => {

      this._timers.events = setTimeout( () => {

        if( this._promises.resolve.events ) {
          this._promises.resolve.events()
        }

        this._promises.resolve.events = false
        this._promises.promise.events = false
        this._timers.events = false
        delete this.eventmatch

      }, timeout )

      if( typeof match === "string" ){
        this.eventmatch = new RegExp( match )
      } else {
        this.eventmatch = match
      }

      this._promises.resolve.events = resolve

      /* if we have something already in our buffer */
      this._tevent( "" )
    } )

    return this._promises.promise.events
  }

  /**
    Clear our current buffer to ensure new input
  */
  clearevents() {
    this._receivedtelevents = ""
  }

  /**
    If we are not ringing - send ringing to the other end.
  */
  ring() {
    if( !this.ringing && "uas" === this.type ) {
      this.state.ringing = true
      this._res.send( 180, {
        headers: {
           "User-Agent": "project",
           "Supported": "replaces"
         }
      } )

      this._em.emit( "call.ringing", this )
      callmanager.options.em.emit( "call.ringing", this )
    }
  }

  /**
    Shortcut to hangup with the reason busy.
  */
  busy() {
    this.hangup( hangupcodes.USER_BUSY )
  }

  /**
   * @private
   */
  get _iswebrtc() {

    if( !this.sip || !this.sip.contact ) return false

    let contactstr
    if( Array.isArray( this.sip.contact ) ) {
      contactstr = this.sip.contact[ 0 ].uri
    } else {
      contactstr = this.sip.contact
    }

    /* Have we received remote SDP? */
    if( this.sdp.remote ) {
      return this.sdp.remote.sdp.media[ 0 ] &&
            -1 !== this.sdp.remote.sdp.media[ 0 ].protocol.toLowerCase().indexOf( "savpf" ) /* 'UDP/TLS/RTP/SAVPF' */
    }

    return -1 !== contactstr.indexOf( ";transport=ws" )
    
  }

  /**
   * Answer this (inbound) call and store a channel which can be used. This framework will catch and cleanup this call if this is rejected.
   * @param { object } options
   * @param { boolean } options.early - don't answer the channel (establish) but establish early media (respond to 183).
   *
   * @return {Promise} Returns a promise which resolves if the call is answered, otherwise rejects the promise.
  */
  async answer( options = {} ) {

    if( this.canceled || this.established ) return

    options = { ...callmanager.options, ...this.options, ...options }

    let channeldef
    if( this._req.msg && this._req.msg.body ) {
      /* options.preferedcodecs may have been narrowed down so we still check callmanager as well */
      this.selectedcodec = this.sdp.remote.intersection( options.preferedcodecs, true )
      if( false === this.selectedcodec ) {
        this.selectedcodec = this.sdp.remote.intersection( callmanager.options.preferedcodecs, true )
      }
      let remoteaudio = this.sdp.remote.getaudio()
      if( !remoteaudio ) return

      this.sdp.remote.select( this.selectedcodec )
      
      await call._parsesdpcandidates( remoteaudio, this.sdp.remote.sdp )

      channeldef = call._createchannelremotedef( remoteaudio.address, remoteaudio.port, remoteaudio.audio.payloads[ 0 ] )

      if( this._iswebrtc ) {
        channeldef.remote.dtls = {
          "fingerprint": this.sdp.remote.sdp.media[ 0 ].fingerprint,
          "mode": this.sdp.remote.sdp.media[ 0 ].setup==="passive"?"active":"passive" /* prefer passive for us */
        }

        channeldef.remote.icepwd = this.sdp.remote.sdp.media[ 0 ].icePwd
      }
    }

    /* 
      We might have already opened our audio when we received 183 (early).
    */
    if( this.channels.audio ) {
      this.channels.audio.remote( channeldef.remote )
    } else {
      let ch = await projectrtp.openchannel( channeldef, this._handlechannelevents.bind( this ) )
      this.channels.audio = ch
      this.sdp.local = sdpgen.create()
                .addcodecs( this.selectedcodec )
                .setconnectionaddress( ch.local.address )
                .setaudioport( ch.local.port )

      if( callmanager.options.rfc2833 ) {
        this.sdp.local.addcodecs( "2833" )
      }

      if( this._iswebrtc ) {
        this.sdp.local.addssrc( ch.local.ssrc )
                      .secure( ch.local.dtls.fingerprint, channeldef.remote.dtls.mode )
                      .addicecandidates( ch.local.address, ch.local.port, ch.local.icepwd )
                      .rtcpmux()
      }

      if( this.canceled ) return
    }

    if( options.early ) {
      this.state.early = true
      this._em.emit( "call.early", this )
      callmanager.options.em.emit( "call.early", this )

    } else {
      let dialog = await callmanager.options.srf.createUAS( this._req, this._res, {
        localSdp: this.sdp.local.toString(),
        headers: {
          "User-Agent": "project",
          "Supported": "replaces"
        }
      } )

      this.established = true
      this._dialog = dialog
      this.sip.tags.local = dialog.sip.localTag
      callstore.set( this )

      this._addevents( this._dialog )
      this._em.emit( "call.answered", this )
      callmanager.options.em.emit( "call.answered", this )

    }
  }

  /**
    Private helper function to add events to our RTP channel.
    @param {object} e - the rtp event
    @private
  */
  _handlechannelevents( e ) {

    try {
      this._em.emit( "channel", { "call": this, "event": e } )
    } catch ( e ) { console.trace( e ) }

    if( "close" === e.action ) {
      /* keep a record */
      if( this.channels.audio.history ) {
        this.channels.closed.audio.push( this.channels.audio.history )
      } else {
        this.channels.closed.audio.push( e )
      }
      
      this.channels.audio = false
      if( this._state._onhangup ) {
        this._cleanup()
        return
      }
      
      this.hangup() /* ? */
      return
    }

    if( "telephone-event" === e.action ) {
      this._tevent( e.event )
    }

    if( this._eventconstraints ) {
      let constraintkeys = Object.keys( this._eventconstraints )
      for( const k of constraintkeys ) {

        if( "object" === typeof this._eventconstraints[ k ] ) {
          /* regex */
          if( !e[ k ].match( this._eventconstraints[ k ] ) ) {
            return
          }
        } else if( this._eventconstraints[ k ] != e[ k ] ) {
          /* not a match */
          return
        }
      }
    }

    /* 
    We get here if the contraints match OR it is a tel event.
    A close event will be caught on call clean up.
    */

    if( this._timers.anyevent ) clearTimeout( this._timers.anyevent )
    this._timers.anyevent = false

    let r = this._promises.resolve.channelevent
    this._promises.resolve.channelevent = false
    this._promises.promise.channelevent = false
    if( r ) r( e )

  }

  /**
  Wait for any event of interest. DTMF or Audio (channel close, audio event etc).
  When this is extended to SIP DTMF this will be also included.

  constraints will limit the promise firing to one which matches the event we expect.
  timeout will force a firing.

  A telephone event will resolve this promise as we typically need speech to be interupted
  by the user. Note, peeking a telephone-event (i.e. DTMF) will not clear it like waitfortelevents will.
  @param { regex } constraints - event to filter for from our RTP server - excluding DTMF events - these will always return
  */
  waitforanyevent( constraints, timeout = 500 ) {

    if( this.destroyed ) throw "Call already destroyed"
    if ( this._promises.promise.channelevent ) return this._promises.promise.channelevent

    this._eventconstraints = constraints

    this._promises.promise.channelevent = new Promise( ( resolve ) => {
      this._promises.resolve.channelevent = resolve
    } )

    this._timers.anyevent = setTimeout( () => {
      let r = this._promises.resolve.channelevent
      this._promises.promise.channelevent = false
      this._promises.resolve.channelevent = false
      if( r ) r( "timeout" )
    }, timeout * 1000 )

    return this._promises.promise.channelevent
  }

  /**
   * Place the call on hold. TODO.
   */
  hold() {
    this._hold()
    if( this.state.held ) {
      this._dialog.modify( this.sdp.local.toString() )
    }
  }

  /**
   * Take a call off hold.
   */
  unhold() {
    this._unhold()
    if( !this.state.held ) {
      this._dialog.modify( this.sdp.local.toString() )
    }
  }

  /**
   * Set the sound soup for music on hold.
   * @param { object } soup - sound soup as described in projectrtp
   */
  set moh( soup ) {
    this._moh = soup 
  }

  /**
   * Return the current moh
   */
  get moh() {
    if( this._moh ) {
      return this._moh
    }
    return callmanager.options.moh
  }

  /**
   * If we have been placed on hold (and it has been neotiated) then configure audio to match.
   * @private
   */
  _hold() {

    if( this.state.held ) return
    this.state.held = true

    this.channels.audio.direction( { "send": false, "recv": false } )
    this.sdp.local.setaudiodirection( "inactive" )

    let other = this.other
    if( other ) {
      other.channels.audio.unmix()
      other.channels.audio.play( this.moh )
    }

    this._em.emit( "call.hold", this )
    callmanager.options.em.emit( "call.hold", this )
  }

  /**
    Same as _hold.
    @private
  */
  _unhold() {
    if( !this.state.held ) return
    this.state.held = false

    this.channels.audio.direction( { "send": true, "recv": true } )
    this.sdp.local.setaudiodirection( "sendrecv" )

    let other = this.other
    if( other ) {
      this.channels.audio.mix( other.channels.audio )
    }

    this._em.emit( "call.unhold", this )
    callmanager.options.em.emit( "call.unhold", this )
  }

  /**
    As part of the transfer flow a subscription is implied during a transfer which we must update the transferee.
    @private
  */
  async _notifyreferfail( id ) {

    let idstr = ""
    if( id ) {
      idstr = ";id=" + id
    }

    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer" + idstr,
        "Subscription-State": "terminated;reason=error",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 400 Ok\r\n"
    }

    await this._dialog.request( opts ).catch( ( e ) => {
      console.trace( e )
    } )
  }

  /**
    As part of the transfer flow a subscription is implied during a transfer which we must update the transferee.
    @private
  */
  async _notifyrefercomplete( id ) {

    let idstr = ""
    if( id ) {
      idstr = ";id=" + id
    }

    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer" + idstr,
        "Subscription-State": "terminated;reason=complete",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 200 Ok\r\n"
    }

    await this._dialog.request( opts )
      .catch( ( e ) => {
        console.trace( e )
      } )
  }

  /**
    As part of the transfer flow a subscription is implied during a transfer which we must update the transferee.
    @private
  */
  async _notifyreferstart( id ) {

    let idstr = ""
    if( id ) {
      idstr = ";id=" + id
    }

    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer" + idstr,
        "Subscription-State": "active;expires=60",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 100 Trying\r\n"
    }

    await this._dialog.request( opts )
      .catch( ( e ) => {
        console.trace( e )
      } )
  }

  /**
    Send out modified SDP to get the audio to the new location.
    @private
  */
  async _modifyforxfer() {
    this.sdp.local.setaudiodirection( "sendrecv" )
    await this._dialog.modify( this.sdp.local.toString() )
      .catch( ( e ) => {
        console.trace( e )
      } )
  }

  /**
    Add events for the drachtio dialog object that this object requires.
    @private
  */
  _addevents( dialog ) {

    /* Drachtio doesn't appear to have finished SE support, i.e. it sends
    a regular INVITE when we set the Supported: timer and Session-Expires headers
    but it doesn't appear to indicate to us when it does fail. It most cases our
    RTP stall timer will kick in first, but if a call is placed on hold followed
    by AWOL... */
    this._timers.seinterval = setInterval( async () => {
      let opts = {
        "method": "INVITE",
        "body": this.sdp.local.toString()
      }

      let res = await dialog.request( opts )
        .catch( ( e ) => {
          console.trace( e )
          this.hangup( hangupcodes.USER_GONE )
        } )

      if( !this.destroyed && 200 != res.msg.status ) {
        this.hangup( hangupcodes.USER_GONE )
      }

    }, callmanager.options.seexpire )

    dialog.on( "destroy", ( req ) => {
      this._onhangup( "wire" )
    } )

    dialog.on( "info", async ( req, res ) => {
      if( "application/dtmf-relay" === req.get( "Content-Type" ).toLowerCase() &&
            parseInt( req.get( "content-length" ) ) > 0 ) {

        const matches = req.msg.body.match( /Signal=(.+?)/i )
        if( !matches || !Array.isArray( matches ) || matches.length < 2 ) return res.send( 415, "Badly formated SIP INFO" )

        const digit = matches[ 1 ]
        this._tevent( digit )
        const other = this.other
        if( other && other.channels.audio ) {
          other.channels.audio.dtmf( digit )
        }

        return res.send( 200 )
      }
      
      return res.send( 415, "Unsupported Media Type" )
    } )

    dialog.on( "modify", ( req, res ) => {
      //  The application must respond, using the res parameter provided.
      if( "INVITE" === req.msg.method ) {

        let sdp = sdpgen.create( req.msg.body )
        let media = sdp.getmedia()

        let ip
        if( sdp && sdp && sdp.sdp.connection && sdp.sdp.connection.ip ) {
          ip = sdp.sdp.connection.ip
        }

        /* this was tested against jssip - which I don't think is correct. It was sending us
        sendonly when placing the call on hold. It didn't change the connection IP (although it did set the rtcp connection ip to 0.0.0.0!). */
        if( ( "inactive" === media.direction || "sendonly" === media.direction || "0.0.0.0" === ip ) && !this.state.held ) {
          this._hold()
          res.send( 200, {
            "headers": {
              "Subject" : "Call on hold",
              "User-Agent": "project",
              "Allow": "INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY",
              "Supported": "replaces"
            },
            "body": this.sdp.local.toString()
          } )
        } else if( "inactive" !== media.direction && "sendonly" !== media.direction && "0.0.0.0" !== ip && this.state.held ) {
          this._unhold()
          res.send( 200, {
            "headers": {
              "Subject" : "Call off hold",
              "User-Agent": "project"
            },
            "body": this.sdp.local.toString()
          } )
        } else {
          /* Unknown - but respond to keep the call going */
          res.send( 200, {
            "headers": {
              "Subject" : "Ok",
              "User-Agent": "project"
            },
            "body": this.sdp.local.toString()
          } )
        }
      }
    } )

    dialog.on( "refer", async ( req, res ) => {
      try {
        /*
          We only support the xfer of 2 legged calls. The xfered call will pick up
          the auth from the transferee. For example, inbound anonymous call, gets handled
          by user 1. User 1 then refers - to internal extension, so this can has now been
          authed by user 1 - so has access to internal extenions.
        */
        this._req = req
        this._res = res

        if( !this.other ) return res.send( 400, "1 legged calls" )

        /* Auth the request - todo make a way of allow un authed refer - but we should nudge to secure */
        if( this.referauthrequired ) {
          await this.auth()
          if( !this.state.authed ) return
          if( this.destroyed ) return
        }

        if( !req.has( "refer-to" ) ) {
          res.send( 400, "Bad request - no refer-to" )
          return
        }

        let referto = req.getParsedHeader( "refer-to" )
        let parsedrefuri = parseuri( referto.uri )

        if( !parsedrefuri || !parsedrefuri.user ) {
          res.send( 400, "Bad request - no refer-to user" )
          return
        }

        if( !parsedrefuri.host ) {
          res.send( 400, "Bad request - no refer-to host" )
          return
        }

        /*
        Example refer to fields
        Refer-To: sip:alice@atlanta.example.com

        Refer-To: <sip:bob@biloxi.example.net?Accept-Contact=sip:bobsdesk.
              biloxi.example.net&Call-ID%3D55432%40alicepc.atlanta.example.com>

        Refer-To: <sip:dave@denver.example.org?Replaces=12345%40192.168.118.3%3B
                  to-tag%3D12345%3Bfrom-tag%3D5FFE-3994>

        Refer-To: <sip:carol@cleveland.example.org;method=SUBSCRIBE>
        */

        /* getParsedHeader doesn't appear to parse tags in uri params */
        let replacesuri = decodeURIComponent( referto.uri )
        let replaces = replacesuri.match( /replaces=(.*?)(;|$)/i )

        if( null !== replaces ) {
          await this._runattendedxfer( req, res, replaces, replacesuri )
          return
        }

        await this._runblindxfer( req, res, referto )
      } catch( e ) {
        console.trace( e )
      }

    } )
  }

  /**
  We have authed, parsed the headers and decided we have been asked to perform
  a blind xfer on the other leg.
  @private
  */
  async _runblindxfer( req, res, referto ) {
    try {
      let othercall = this.other
      if( !othercall ) return res.send( 400, "We have no-one to refer" )

      othercall.state.refered = true

      this.detach()
      if( this.channels.audio ) this.channels.audio.unmix()
      if( othercall.channels.audio && this.moh ) othercall.channels.audio.play( this.moh )

      res.send( 202 )
      await this._notifyreferstart()

      othercall.referingtouri = referto.uri
      othercall.referedby = this
      othercall._em.emit( "call.referred", othercall )
      callmanager.options.em.emit( "call.referred", othercall )
      await this._notifyrefercomplete()

      /* As part of the call flow the client will send us a hangup next - so only set the cause */
      //this._sethangupcause( "wire", hangupcodes.BLIND_TRANSFER )
      await this.hangup( hangupcodes.BLIND_TRANSFER )

    } catch ( e ) {
      console.trace( e )
    }
  }

  /**
  Attended xfers have 4 calls. 2 pairs.
  a_1 -> b_1
  b_2 -> c_1

  b wants to connect a and c and then step out of the way
  where b_2 is the active call and b_1 is the one b placed on hold
  therefore b_2 = this

  It is also pottential this could be requested
  a_1 -> b_1
  b_2 <- c_1

  or

  a_1 <- b_1
  b_2 -> c_1

  or

  a_1 <- b_1
  b_2 <- c_1

  ends up with
  a_1 - c_1

  An attended transfer could also go to an application - not other call:
  a_1 <- b_1
  b_2 - conference

  ends up with
  a_1 - b_2 (rtp channel)

  @private
  */
  async _runattendedxfer( req, res, replaces, replacesuri ) {
    let totag = replacesuri.match( /to-tag=(.*?)(;|$)/i )
    let fromtag = replacesuri.match( /from-tag=(.*?)(;|$)/i )

    if( replaces.length < 3 || totag.length < 3 || fromtag.length < 3 ) {
      res.send( 400, "Bad call reference for replaces" )
      return
    }

    let searchfor = { "callid": replaces[ 1 ], "tags": { "local": totag[ 1 ], "remote": fromtag[ 1 ] } }
    let failed = false

    let b_1 = await callstore.getbycallid( searchfor )
      .catch( ( e ) => {
        console.trace( e )
        res.send( 400, e )
        failed = true
      } )
    if( failed || !b_1 ) return res.send( 400, "No call matches that call id" )
    if( !b_1.sdp.remote ) return res.send( 400, "No remote sdp negotiated (b_1)!" )
    let b_2 = this /* so we can follow the above terminology */

    let c_1 = b_2.other
    if( !c_1 ) c_1 = b_2

    let a_1 = b_1.other
    if( !a_1 ) return res.send( 400, "Can't attened xfer 1 legged calls" )
    if( !a_1.sdp.remote ) return res.send( 400, "No remote sdp negotiated (a_1)!" )

    if( !a_1.channels.audio ) return res.send( 400, "No channel (a_1)" )
    if( !b_1.channels.audio ) return res.send( 400, "No channel (b_1)" )
    if( !b_2.channels.audio ) return res.send( 400, "No channel (b_2)" )
    if( !c_1.channels.audio ) return res.send( 400, "No channel (c_1)" )

    b_1.detach()
    b_2.detach()

    a_1.channels.audio.unmix()
    b_1.channels.audio.unmix()
    b_2.channels.audio.unmix()
    c_1.channels.audio.unmix()

    /* Swap channels and update */

    /* copy all first */
    let a_1_audio = a_1.channels.audio
    let a_1_sdp = a_1.sdp.local
    let a_1_chem = a_1.channels.audio.em
    let b_2_chem = b_2.channels.audio.em

    a_1.channels.audio = b_2.channels.audio
    a_1.channels.audio.em = a_1_chem
    a_1.sdp.local = b_2.sdp.local

    a_1.sdp.local
      .clearcodecs()
      .addcodecs( a_1.selectedcodec )
      .select( a_1.selectedcodec )
      .setaudiodirection( "sendrecv" )

    if( true === callmanager.options.rfc2833 ) {
      a_1.sdp.local.addcodecs( "2833" )
    }

    /* Link logically */
    a_1.adopt( c_1 )

    /* this one will be hung up soon anyway - so it to has to close the correct one  */
    b_2.channels.audio = a_1_audio
    b_2.channels.audio.em = b_2_chem
    b_2.sdp.local = a_1_sdp

    failed = false

    await new Promise( ( resolve ) => {
      res.send( 202, "Refering", {}, ( err, response ) => {
        resolve()
      } )
    } )

    failed = false

    let id = this._req.get( "cseq" ).match( /(\d+)/ )[ 0 ]
    await this._notifyreferstart( id )
      .catch( ( e ) => {
        console.trace( e )
        this._notifyreferfail( id )
        failed = true
      } )

    if( failed ) return

    /* modify ports and renegotiate codecs */
    await a_1._modifyforxfer()

    let target = a_1.sdp.remote.getaudio()
    if( target ) {
      /* we should always get in here */
      a_1.channels.audio.remote( call._createchannelremotedef( target.address, target.port, a_1.selectedcodec ).remote )

      /* there might be situations where mix is not the correct thing - perhaps a pop push application? */
      a_1.channels.audio.mix( c_1.channels.audio )

      /* Now inform our RTP server also - we might need to wait untl the target has completed so need a notify mechanism */
      a_1.channels.audio.direction( { "send": false, "recv": false } )

      a_1._em.emit( "call.mix", a_1 )
      callmanager.options.em.emit( "call.mix", a_1 )
    }

    this._notifyrefercomplete( id )

    a_1.state.refered = true

    this.hangup_cause = Object.assign( { "src": "wire" }, hangupcodes.ATTENDED_TRANSFER )
    b_1.hangup( hangupcodes.ATTENDED_TRANSFER )
  }

  /**
  Helper function to create a channel target definition
  @private
  @param { string } address - remote address (ip)
  @param { number } port - remote port
  @param { number } codec
  @param { string } fingerprint - remote sha 256 fingerprint
  @param { string } mode - "active"|"passive"
  */
  static _createchannelremotedef( address, port, codec, fingerprint, mode /* active|passive */ ) {
    const chandef = {
      "remote": {
        "address": address,
        "port": port,
        "codec": codec
      }
    }

    if( fingerprint ) {
      chandef.remote.dtls = {
        "fingerprint": {
          "hash": fingerprint
        },
        "mode": mode
      }
    }
    return chandef
  }

  /**
  Sets our hangup cause correctly - if not already set.
  @private
  */
  _sethangupcause( src, reason ) {
    if( !this.hangup_cause ) {
      if( reason ) {
        this.hangup_cause = reason
      } else {
        this.hangup_cause = hangupcodes.NORMAL_CLEARING
        if( "wire" === src && !this.state.established ) {
          this.hangup_cause = hangupcodes.ORIGINATOR_CANCEL
        }
      }
      /* make sure we don't copy src back into our table of causes */
      this.hangup_cause = Object.assign( { "src": src }, this.hangup_cause )
    }
  }

  /**
    Use this as our destructor. This may get called more than once depending on what is going on.
    Clean up all timers and tidy up any outstanding promises.
    @private
  */
  _cleanup() {

    if( this.state.cleaned ) return
    this.state.cleaned = true

    /* Clean up promises (ensure they are resolved) and clear any timers */
    for ( const [ key, value ] of Object.entries( this._timers ) ) {
      if( value ) clearTimeout( value )
      this._timers[ key ] = false
    }

    let authreject = this._promises.reject.auth
    this._promises.reject.auth = false
    this._promises.resolve.auth = false
    if( authreject ) authreject( this )

    let resolves = []
    for ( const [ key, value ] of Object.entries( this._promises.resolve ) ) {
      if( value ) resolves.push( value )
      this._promises.resolve[ key ] = false
    }

    /* Call outstanding resolves for promises - this will trigger out hangup promise also */
    resolves.forEach( r => r( this ) )

    this._em.emit( "call.destroyed", this )
    callmanager.options.em.emit( "call.destroyed", this )

    this._em.emit( "call.reporting", this )
    callmanager.options.em.emit( "call.reporting", this )

    this.removealllisteners()
  }

  /**
   * Used by our frame to a) continue a hangup which has been initiated by either us or the network.
   * Complete the hangup, including hanging up all children and waiting for them to complete their
   * hangup.
   * @param {string} [us] - "us"|"wire"
   * @param {object} reason - one of the reasons from the hangupcodes enum - only used if we havn't alread set our reason
   * @private
  */
  async _onhangup( src = "us", reason ) {

    if( this._state._onhangup ) {
      await this.waitforhangup()
      return
    }
    this._state._onhangup = true

    /* hangup our children */
    let hangups = []
    for( let child of this.children ) {
      hangups.push( child.hangup( this.hangup_cause ) )
    }

    /* wait for all children to have completed their hangup */
    if( hangups.length > 0 ) {
      await Promise.all( hangups )
    }

    await callstore.delete( this )

    this._sethangupcause( src, reason )

    /* flag destroyed so when we receive our close event we know what to do */
    this.destroyed = true
    if( this.channels.audio ) {
      this.channels.audio.close()
      this._timers.cleanup = setTimeout( () => {
        console.trace( "Timeout waiting for channel close, cleaning up anyway", this.uuid )
        this._cleanup() 
      }, 60 * 1000 )

      await this.waitforhangup()
    } else {
      this._cleanup()
    }
  }

  /**
   * Hangup the call with reason. Public interface for callers to use.
   * @param {object} reason - one of the reasons from the hangupcodes enum
  */
  async hangup( reason ) {

    if( this._state._hangup || this._state._onhangup ) {
      await this.waitforhangup()
      return
    }
    this._state._hangup = true

    await callstore.delete( this )

    this._sethangupcause( "us", reason )

    if( this.established ) {
      try {
        await this._dialog.destroy()
      } catch( e ) { console.trace( e ) }

    } else if( "uac" === this.type ) {
      try {
        if( this._req ) this._req.cancel()
      } catch( e ) { console.trace( e ) }

      this.canceled = true

    } else {
      try {
        this._res.send( this.hangup_cause.sip )
      } catch( e ) { console.trace( e ) }
    }

    await this._onhangup( "us", reason )
  }

  async waitforhangup() {

    if( !this._promises.promise.hangup ) {
      return
    }

    await this._promises.promise.hangup
    this._promises.promise.hangup = false
    this._promises.resolve.hangup = false

  }

  /**
  Send an UPDATE. Use to updated called id, caller id, sdp etc. Send in dialog - TODO look how to send
  early as this is recomended in the RFC.
  @param { Object } options
  @param { remoteid } [ options.remote ] - if present update the remote called/caller id (display) - if not will get from other
  */
  async update( options ) {

    if( !this._dialog ) {
      console.trace( "Early update not currently supported" )
      return false
    }

    /* Check client supports update */
    if( !this._req ) return false
    if( !this._req.has( "Allow" ) ) return false
    let allow = this._req.get( "Allow" )
    if( !/\bupdate\b/i.test( allow ) ) return false

    let requestoptions = {}
    requestoptions.method = "update"
    if( this.sdp.local ) {
      requestoptions.body = this.sdp.local.toString()
    }

    requestoptions.headers = {}

    let remoteidheader = "P-Preferred-Identity"
    let name = ""
    let user = "0000000000"
    let realm = "localhost.localdomain"

    if( options && options.remote ) {
      name = options.remote.display.replace( /[^\w\-\s']+/g, "" ) /* only allow alpa num whitespace and ' */
      realm = options.remote.realm
      user = options.remote.username
    } else {
      let other = this.other
      if( other ) {
        let remote = other.remote
        name = remote.name.replace( /[^\w\-\s']+/g, "" ) /* only allow alpa num whitespace and ' */
        realm = remote.host
        user = remote.user
      }
    }

    let remoteid = `"${name}" <sip:${user}@${realm}>`
    requestoptions.headers[ remoteidheader ] = remoteid

    this._dialog.request( requestoptions )
    return true
  }

  /**
  @callback earlycallback
  @param { call } call - our call object which is early
  */

  /**
  @callback confirmcallback
  @async
  @param { call } call - our call object which is early
  */

  /**
  @callback failcallback
  @param { call } call - our call object which is early
  */

  /**
  @summary Creates a new SIP dialog. Returns a promise which resolves
  when the dialog is either answered (or cancelled for some reason).
  The promise resolves to a new call is one is generated, or undefined if not.
  @param { Object } [ options ] - Options object. See default_options in index.js for more details.
  @param { string } [ options.contact ] - The contact string
  @param { boolean } [ options.orphan ] - If present and true then orphan the new call
  @param { string } [ options.auth.username ] - If SIP auth required username
  @param { string } [ options.auth.password ] - If SIP auth required password
  @param { object } [ options.headers ] - Object containing extra sip headers required.
  @param { object } [ options.uactimeout ] - override the deault timeout
  @param { boolean } [ options.late ] - late negotiation
  @param { entity } [ options.entity ] - used to store this call against and look up a contact string if not supplied.
  @param { string } [ options.entity.username ]
  @param { string } [ options.entity.realm ]
  @param { string } [ options.entity.uri ]
  @param { number } [ options.entity.max ] - if included no more than this number of calls for this entity (only if we look user up)
  @param { object } [ callbacks ]
  @param { earlycallback } [ callbacks.early ] - callback to provide a call object with early call (pre dialog)
  @param { confirmcallback } [ callbacks.confirm ] - called when a dialog is confirmed but before it is bridged with a parent - this provides an opportunity for another call to adopt this call
  @param { failcallback } [ callbacks.fail ] - Called when child is terminated
  @return { Promise< call | false > } - returns a promise which resolves to a new call object if a dialog has been confirmed. If none are confirmed ten return false. Each attempt is fed into callbacks.early.
  */
  async newuac( options, callbacks = {} ) {

    /* If max-forwards is not specified then we decrement the parent and pass on */
    if( !( "headers" in options ) ) options.headers = {}
    if( !options.headers[ Object.keys( options.headers ).find( key => key.toLowerCase() === "max-forwards" ) ] ) {
      if( !this._req.has( "Max-Forwards" ) ) {
        return false
      }
  
      let maxforwards = parseInt( this._req.get( "Max-Forwards" ) )
      if( maxforwards <= 0 ) return false
      options.headers[ "Max-Forwards" ] = maxforwards - 1
    }

    if( !options.orphan ) {
      options.parent = this
    }
    
    return await call.newuac( options, callbacks )
  }

  /**
  @summary Creates a new SIP dialog(s). Returns a promise which resolves
  when the dialog is either answered (or cancelled for some reason).
  The promise resolves to a new call is one is generated, or undefined if not.
  @param { object } [ options ] - Options object. See default_options in index.js for more details.
  @param { call } [ options.parent ] - the parent call object
  @param { string } [ options.contact ] - The contact string
  @param { string } [ options.auth.username ] - If SIP auth required username
  @param { string } [ options.auth.password ] - If SIP auth required password
  @param { object } [ options.headers ] - Object containing extra sip headers required.
  @param { object } [ options.uactimeout ] - override the deault timeout
  @param { boolean | number } [ options.autoanswer ] - if true add call-info to auto answer, if number delay to add
  @param { boolean } [ options.late ] - late negotiation
  @param { entity } [ options.entity ] - used to store this call against and look up a contact string if not supplied.
  @param { string } [ options.entity.username ]
  @param { string } [ options.entity.realm ]
  @param { string } [ options.entity.uri ]
  @param { number } [ options.entity.max ] - if included no more than this number of calls for this entity (only if we look user up)
  @param { object } [ options.callerid ]
  @param { string } [ options.callerid.number ]
  @param { string } [ options.callerid.name ]
  @param { object } [ callbacks ]
  @param { earlycallback } [ callbacks.early ] - callback to provide a call object with early call (pre dialog)
  @param { confirmcallback } [ callbacks.confirm ] - called when a dialog is confirmed but before it is bridged with a parent - this provides an opportunity for another call to adopt this call
  @param { failcallback } [ callbacks.fail ] - Called when child is terminated
  @return { Promise< call | false > } - returns a promise which resolves to a new call object if a dialog has been confirmed. If none are confirmed ten return false. Each attempt is fed into callbacks.early.
  */
  static async newuac( options, callbacks = {} ) {

    if( !options.contact && !options.entity ) return false

    /* If we don't have a contact we need to look up the entity */
    if( undefined === options.contact ) {

      /* We check call count early - so we can call multiple registrations */
      if( options.entity && options.entity.max ) {
        if( !options.entity.uri ) {
          options.entity.uri = options.entity.username + "@" + options.entity.realm
        }

        let cs = await callstore.getbyentity( options.entity.uri )
        if( cs && cs.size >= options.entity.max ) {
          return false
        }
      }
      
      /* If we have an entity - we need to look them up */
      if( !callmanager.options.registrar ) return false
      if( !options.entity ) return false

      let contactinfo = await callmanager.options.registrar.contacts( options.entity )
      if( !contactinfo || 0 == contactinfo.contacts.length ) {
        return false
      }

      let othercalls = []
      let ourcallbacks = {}
      let failcount = 0

      let waitonchildrenresolve
      let waitonchildrenpromise = new Promise( ( resolve ) => {
        waitonchildrenresolve = resolve
      } )

      ourcallbacks.early = ( c ) => {
        othercalls.push( c )
        if( callbacks.early ) callbacks.early( c )
      }

      ourcallbacks.fail = ( c ) => {
        failcount++
        if( failcount >= othercalls.length ) {
          /* we have no more to try */
          waitonchildrenresolve( c )
        }
        if( callbacks.fail ) callbacks.fail( c )
      }

      ourcallbacks.confirm = ( c ) => {
        waitonchildrenresolve( c )
        if( callbacks.confirm ) callbacks.confirm( c )
      }
      
      for( let contact of contactinfo.contacts ) {
        if( undefined === contact ) continue
        let newoptions = { ...options }
        if( contact.contact && "string" == typeof contact.contact ) {
          newoptions.contact = contact.contact
          call.newuac( newoptions, ourcallbacks )
        }
      }

      let child = await waitonchildrenpromise

      if( child && !child.parent ) {
        /* we have to terminate other calls we generated as this 
        will not happen in the call object without a parent */
        for( let other of othercalls ) {
          if( other.uuid !== child.uuid ) {
            other.detach()
            other.hangup( hangupcodes.LOSE_RACE )
          }
        }
      }
      return child
    }

    let newcall = new call()
    newcall.type = "uac"

    if( options.parent ) {
      options.parent.adopt( newcall )
    }

    newcall.options = {
      headers: { ...options.headers }
    }

    let name = ""
    let user = "0000000000"
    let realm = "localhost.localdomain"

    if( options.parent ) {
      let remote = options.parent.remote
      if( remote ) {
        name = remote.name.replace( /[^\w\-\s']+/g, "" ) /* only allow alpa num whitespace and ' */
        realm = remote.host
        user = remote.user
      }
    }

    /* oveide caller id */
    if( options.callerid ) {
      if( options.callerid.number ) {
        user = options.callerid.number
      }

      if( options.callerid.name ) {
        name = options.callerid.name
      }
    }

    let callerid = `"${name}" <sip:${user}@${realm}>`

    newcall.options.headers[ "Remote-Party-ID" ] = callerid
    newcall.options.headers[ "From" ] = callerid

    if( options.entity ) {
      newcall._entity = options.entity
      callstore.set( newcall )
    }

    if( true === options.autoanswer ) {
      newcall.options.headers[ "Call-Info" ] = `<sip:${user}@${realm}>;answer-after=0`
    } else if ( "number" == typeof options.autoanswer ) {
      newcall.options.headers[ "Call-Info" ] = `<sip:${user}@${realm}>;answer-after=${options.autoanswer}`
    }

    // Polycom
    // Alert-Info: <https://www.babblevoice.com/polycom/LoudRing.wav>
    // Vtech
    // Alert-Info: <http://www.babblevoice.com>;info=ringer2
    

    // spread is not recursive
    const tmpheaders =  { ...callmanager.options.headers, ...newcall.options.headers, ...options.headers }
    newcall.options = { ...callmanager.options, ...newcall.options, ...options }
    newcall.options.headers = tmpheaders

    newcall._timers.newuac = setTimeout( () => {
      newcall.hangup( hangupcodes.REQUEST_TIMEOUT )
    }, newcall.options.uactimeout )

    if( newcall.options.late ) {
      newcall.options.noAck = true /* this is a MUST for late negotiation */
    } else {
      newcall.channels.audio = await projectrtp.openchannel( newcall._handlechannelevents.bind( newcall ) )

      newcall.sdp.local = sdpgen.create().addcodecs( newcall.options.preferedcodecs )
      newcall.sdp.local.setaudioport( newcall.channels.audio.local.port )
        .setconnectionaddress( newcall.channels.audio.local.address )

      /* DTLS is only supported ( outbound ) on websocket connections */
      newcall.sip.contact = options.contact
      if( newcall._iswebrtc ) {
        newcall.sdp.local
          .addssrc( newcall.channels.audio.local.ssrc )
          .secure( newcall.channels.audio.local.dtls.fingerprint ,"passive" )
          .addicecandidates( newcall.channels.audio.local.address, newcall.channels.audio.local.port, newcall.channels.audio.local.icepwd )
          .rtcpmux()
      }

      /* Create our SDP */
      newcall.options.localSdp = newcall.sdp.local.toString()
    }

    let addressparts = parseuri( options.contact )
    if( addressparts ) {
      newcall.network.remote.address = addressparts.host
      if( addressparts.port ) newcall.network.remote.port = addressparts.port
    }

    newcall._dialog = await callmanager.options.srf.createUAC( options.contact, newcall.options, {
      cbRequest: ( err, req ) => {

        if( !req ) {
          newcall.state.destroyed = true
          console.trace( "No req object??", err )
          return
        }

        newcall._req = req
        newcall.state.trying = true

        newcall.sip = {
          "callid": req.getParsedHeader( "call-id" ),
          "tags": {
            "local": req.getParsedHeader( "from" ).params.tag,
            "remote": ""
          },
          "contact": [ { "uri": options.contact } ]
        }

        callstore.set( newcall )
        if( callbacks && callbacks.early ) callbacks.early( newcall )
        callmanager.options.em.emit( "call.new", newcall )
      },
      cbProvisional: async ( res ) => {
        newcall._res = res
        if( 180 === res.status ) {
          newcall._onring()
        } else if( 183 === res.status ) {
          await newcall._onearly()
        }

        if( newcall.canceled ) {
          newcall.hangup()
        }
      }
    } ).catch( ( err ) => {
      if ( undefined !== err.status ) {
        let reason = hangupcodes.REQUEST_TERMINATED
        if( err.status in inboundsiperros ) reason = inboundsiperros[ err.status ]

        if( newcall ) newcall._onhangup( "wire", reason )
      } else {
        console.trace( err )
      }
    } )

    if( newcall._timers.newuac ) clearTimeout( newcall._timers.newuac )
    newcall._timers.newuac = false

    if( newcall.state.destroyed ) {

      if( callbacks && callbacks.fail ) callbacks.fail( newcall )
      return newcall
    }

    newcall.sdp.remote = sdpgen.create( newcall._dialog.remote.sdp )

    if( callbacks.confirm ) await callbacks.confirm( newcall )
    return await newcall._onanswer()
  }

  /**
  Create a new object when we receive an INVITE request.

  @param { object } req - req object from drachtio
  @param { res } res - res object from drachtio
  @returns { call }
  */
  static frominvite( req, res ) {
    let c = new call()

    c.type = "uas"

    /**
      @typedef { Object } source
      @property { string } address
      @property { number } port
      @property { string } protocol
    */

    c.network.remote.address = req.source_address
    c.network.remote.port = req.source_port
    c.network.remote.protocol = req.protocol

    c.sip.callid = req.getParsedHeader( "call-id" )
    c.sip.contact = req.getParsedHeader( "contact" )
    c.sip.tags.remote = req.getParsedHeader( "from" ).params.tag

    /**
    @member
    @private
    */
    c._req = req
    c._req.on( "cancel", () => c._oncanceled.bind( c ) )
    /**
    @member
    @private
    */
    c._res = res

    callstore.set( c ).then( () => {
      callmanager.options.em.emit( "call.new", c )
    } )

    if( c._req.msg && c._req.msg.body ) {
      c.sdp.remote = sdpgen.create( c._req.msg.body )
    }

    return c

  }

  static hangupcodes = hangupcodes
  static setcallmanager( cm ) {
    callmanager = cm
  }
}

module.exports = call
