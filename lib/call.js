
const { v4: uuidv4 } = require( "uuid" )
const events = require( "events" )
const dns = require( "node:dns" )

const projectrtp = require( "@babblevoice/projectrtp" ).projectrtp

const sdpgen = require( "./sdp.js" )
const callstore = require( "./store.js" )

const sipauth = require( "@babblevoice/babble-drachtio-auth" )

const ipv6regex = /^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/
const parseurire = /^(sips?):(?:([^\s>:@]+)(?::([^\s@>]+))?@)?([\w\-.]+)(?::(\d+))?((?:;[^\s=?>;]+(?:=[^\s?;]+)?)*)(?:\?(([^\s&=>]+=[^\s&=>]+)(&[^\s&=>]+=[^\s&=>]+)*))?$/
const parseuriparamsre = /([^;=]+)(=([^;=]+))?/g
const parseuriheadersre = /[^&=]+=[^&=]+/g

function parseuri( s ) {
  if( "object" === typeof s )
    return s

  const r = parseurire.exec( s )

  if( r ) {
    return {
      schema: r[ 1 ],
      user: r[ 2 ],
      password: r[ 3 ],
      host: r[ 4 ],
      port: +r[ 5 ],
      params: (r[ 6 ].match( parseuriparamsre ) || [] )
        .map( function( s ) { return s.split( "=" ) } )
        .reduce(function(params, x) { params[x[0]]=x[1] || null; return params }, {} ),
      headers: ( ( r[ 7 ] || "" ).match( parseuriheadersre ) || [])
        .map(function(s){ return s.split( "=") } )
        .reduce(function(params, x) { params[ x[ 0 ] ] = x[ 1 ]; return params }, {} )
    }
  }

  return {}
}

/**
 * Util to convert key names to lowercase
 * @param { object } obj 
 * @returns 
 */
function keynameslower( obj ) {
  return Object.keys( obj ).reduce( ( accumulator, currentvalue ) => {
    accumulator[ currentvalue.toLowerCase() ] = obj[ currentvalue ]
    return accumulator
  }, {} )
}

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

/**
 * Ecapsulate a SIP exception
 * @param { object } hangupcode
 * @param { string } message
 */
class SipError extends Error {
  constructor( hangupcode, message ) {
    super( message )
    this.code = hangupcode.sip
    this.hangupcode = hangupcode
    this.name = "SipError"
  }
}

/* Reverse codes - include inbound error codes.
If not in this list we return REQUEST_TERMINATED during creation */
/*
const inboundsiperros = {
  486: hangupcodes.USER_BUSY,
  408: hangupcodes.REQUEST_TIMEOUT,
  404: hangupcodes.UNALLOCATED_NUMBER,
  603: hangupcodes.DECLINED
}
*/


const inboundsiperros = {}
const hangupcodeskeys = Object.keys( hangupcodes )
for (let i = 0; i < hangupcodeskeys.length; i++) {
  const key = hangupcodeskeys[ i ]
  const value = hangupcodes[ key ]
  inboundsiperros[ value.sip ] = value
}


let callmanager = {
  "options": {}
}

/**
* @typedef { object } entity
* @property { string } uri full uri
* @property { string } [ username ] username part
* @property { string } [ realm ] realm (domain) part
* @property { string } [ display ] how the user should be displayed
* @property { number } [ ccc ] - Current Call Count
*/

class call {

  #noack = false

  /**
  * Construct our call object with all defaults, including a default UUID.
  * @constructs call
  * @hideconstructor
  */
  constructor() {
    this.uuid = uuidv4()

    /**
    @enum { string } type "uas" | "uac"
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
      @property { boolean } picked
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
      "refered": false,
      "picked": false
    }

    /**
     * Protected for this module
     */
    this._state = {
      "_onhangup": false,
      "_hangup": false
    }

    /**
     * @private
     * @summary Headers to pass onto the b leg
     */
    this.propagate = {
      headers: {}
    }

    /**
    * @summary Channels which have been created
    */
    this.channels = {
      "audio": undefined,
      "closed": {
        "audio": []
      },
      "count": 0
    }

    /**
    * @summary Store our local and remote sdp objects
    */
    this.sdp = {
      "local": undefined,
      "remote": undefined
    }

    /**
    * @summary UACs we create
    */
    this.children = new Set()
    /**
    * @summary Who created us
    */
    this.parent = undefined

    /** @summary Other channels which we might need - for things like opening a channel on the same node. */
    this.relatives = new Set()

    /**
     * @typedef {Object} epochs
     * @property {number} startat UNIX timestamp of when the call was started (created)
     * @property {number} answerat UNIX timestamp of when the call was answered
     * @property {number} endat UNIX timestamp of when the call ended
     */

    /** @member {epochs} */
    this.epochs = {
      "startat": Math.floor( +new Date() / 1000 ),
      "answerat": 0,
      "endat": 0,
      "mix": 0
    }

    /**
     * @typedef { object } sipdialog
     * @property { string } callid
     * @property { object } tags
     * @property { string } tags.local
     * @property { string } tags.remote
     */
    /** @member { sipdialog } */
    this.sip = {
      "callid": undefined,
      "tags": {
        "remote": "",
        "local": ""
      }
    }

    /**
    * For inbound calls - this is discovered by authentication. For outbound
    * this is requested by the caller - i.e. the destination is the registered user.
    * @type { entity }
    * Protected for this module.
    */
    this._entity

    /**
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
    * @summary user definable object that allows other modules to store data in this call.
    */
    this.vars = {}

    /**
    @member {string}
    @private
    */
    this._receivedtelevents = ""

    /**
    * @private
    */
    this._promises = {
      "resolve": {
        "auth": undefined,
        "hangup": undefined,
        "events": undefined,
        "channelevent": undefined
      },
      "reject": {
        "auth": undefined,
        "channelevent": undefined
      },
      "promise": {
        "hangup": undefined,
        "events": undefined,
        "channelevent": undefined
      }
    }

    this._promises.promise.hangup = new Promise( ( resolve ) => {
      this._promises.resolve.hangup = resolve
    } )

    /**
    * @private
    */
    this._timers = {
      "auth": undefined,
      "newuac": undefined,
      "events": undefined,
      "seinterval": undefined,
      "anyevent": undefined
    }

    /**
    * @private
    */
    this._em = new events.EventEmitter()

    /**
     * copy default 
     * @type { calloptions }
     */
    this.options = { ...callmanager.options }
    this.options.headers = {}

    /**
    * @private
    */
    this._auth = sipauth.create( callmanager.options.proxy )

    this.referauthrequired = callmanager.options.referauthrequired

    /**
    * Enable access for other modules.
    */
    this.hangupcodes = hangupcodes

    /**
     * If the call is referred somewhere, this is the url we use
     * @type { string }
     */
    this.referingtouri
  }

  /**
   * 
   * @returns { entity }
   */
  #getentityforuac() {
    if( "uac" == this.type ) {
      return this.options.entity
    }
  }

  /**
   * 
   * @returns { entity }
   */
  #getentityforuas() {
    if( !this._entity ) return

    if( this._entity.uri ) {
      if( !this._entity.username ) {
        const uriparts = this._entity.uri.split( "@" )
        this._entity.username = uriparts[ 0 ]
        if( 1 < uriparts.length )
          this._entity.realm = uriparts[ 1 ]
      }
    }

    if( !this._entity.uri && this._entity.username && this._entity.realm ) {
      this._entity.uri = this._entity.username + "@" + this._entity.realm
    }

    return {
      "username": this._entity.username,
      "realm": this._entity.realm,
      "uri": this._entity.uri,
      "display": this._entity.display?this._entity.display:""
    }
  }

  /**
  * Returns the entity if known (i.e. outbound or inbound authed).
  * @returns { Promise< entity > }
  */
  get entity() {

    return ( async () => {

      let e
      if( "uac" == this.type ) {
        e = this.#getentityforuac()
      } else {
        e = this.#getentityforuas()
      }

      if( !e ) return

      const entitycalls = await callstore.getbyentity( this._entity.uri )
      let entitycallcount = 0
      if( false !== entitycalls ) entitycallcount = entitycalls.size
      e.ccc = entitycallcount

      return e

    } )()
  }

  /**
   * Set the entity information against this call. Itis either set by authentication
   * or externally (for example if we auth by network location).
   * Either ( e.uri ) or ( e.realm and e.username ) are required.
   * @param { entity } e
   */
  set entity( e ) {
    if(  !e.uri && !( e.username && e.realm )  ) return
    this._entity = e

    if( !this._entity.display ) this._entity.display = ""

    if( this._entity.uri ) {
      if( !this._entity.username ) {
        const uriparts = this._entity.uri.split( "@" )
        this._entity.username = uriparts[ 0 ]
        if( 1 < uriparts.length )
          this._entity.realm = uriparts[ 1 ]
      }
    } else if( this._entity.username && this._entity.realm ) {
      this._entity.uri = this._entity.username + "@" + this._entity.realm
    }
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
   * 
   * @returns { object }
   */
  #getremotefromheaders() {
    let parsed
    if( this._req.has( "p-asserted-identity" ) ) {
      parsed = this._req.getParsedHeader( "p-asserted-identity" )
    } else if( this._req.has( "remote-party-id" ) ) {
      parsed = this._req.getParsedHeader( "remote-party-id" )
    }
    return parsed
  }

  getparsedheader( hdr ) {
    if( !this._req ) return
    if( !this._req.has( hdr ) ) return

    return this._req.getParsedHeader( hdr )
  }

  #fixparseduriobj( parsed ) {

    if( !parsed ) parsed = {}
    if( !parsed.uri && parsed.user && parsed.host ) parsed.uri = parsed.user + "@" + parsed.host
    if( parsed.uri && !parsed.user && !parsed.host ) parsed = parseuri( parsed.uri )

    let parseduri = parseuri( parsed.uri )

    if( !parseduri ) parseduri = { "user": parsed.user, "host": parsed.host }
    if( !parsed.params ) parsed.params = {}

    return parsed
  }

  /**
   * Remember: this is from the perspective of us - not the phone. 
   * The phone perspective is the opposite
   * Inbound
   * A call is received - i.e. we receive a SIP invite
   * 
   * Outbound
   * We make an outbound call. i.e. we send an INVITE
   * 
   * Exceptions
   * partycalled/clicktocall - we send an INVITE but that is an inbound call
   * so the invite is i nthe opposie direction.
   * @returns { "inbound" | "outbound" }
   */
  get direction() {
    if( this.options.partycalled ) return "inbound"
    return "uas"==this.type?"inbound":"outbound"
  }

  #overridecallerid( startingpoint ) {

    if( this.options.callerid ) {
      if( "number" in this.options.callerid ) startingpoint.user = this.options.callerid.number
      if( "name" in this.options.callerid ) startingpoint.name = this.options.callerid.name
      if( "host" in this.options.callerid ) startingpoint.host = this.options.callerid.host
    }
  }

  #overridecalledid( startingpoint ) {
    startingpoint.privacy = this.options.privacy

    if( this.options.calledid ) {
      if( "number" in this.options.calledid ) {
        startingpoint.user = this.options.calledid.number
        startingpoint.uri = this.options.calledid.number + "@" + startingpoint.host
      }
      if( "name" in this.options.calledid ) startingpoint.name = this.options.calledid.name
    }
  }

  #fromremoteheaders( startingpoint ) {
    const parsed = this.#fixparseduriobj( this.#getremotefromheaders() )
    if( parsed.uri ) startingpoint.uri = parsed.uri
    if( parsed.user ) startingpoint.user = parsed.user
    if( parsed.host ) startingpoint.host = parsed.host
  }

  #fromcontact( startingpoint ) {
    const dest = parseuri( this.options.contact )
    if( !dest ) return
    if( dest.uri ) startingpoint.uri = dest.uri
    if( dest.user ) startingpoint.user = dest.user
    if( dest.host ) startingpoint.host = dest.host
  }

  #fromdestination( startingpoint ) {
    const dest = this.destination
    startingpoint.user = dest.user
    startingpoint.host = dest.host
  }

  #fromoutentity( startingpoint ) {

    const entity = this.options.entity
    if( entity ) {
      startingpoint.name = entity.display
      startingpoint.uri = entity.uri
      startingpoint.user = entity.username
      startingpoint.host = entity.realm
      return true
    }

    return false
  }

  #frominentity( startingpoint ) {
    const entity = this._entity

    if( entity ) {
      startingpoint.name = entity.display
      startingpoint.uri = entity.uri
      startingpoint.user = entity.username
      startingpoint.host = entity.realm
      return true
    }

    return false
  }

  #fromentity( startingpoint ) {

    if( this.#fromoutentity( startingpoint ) ) return true
    if( this.#frominentity( startingpoint ) ) return true

    return false
  }


  /**
   * We have received an INVITE
   * @param { object } startingpoint 
   */
  #calledidforuas( startingpoint ) {
    this.#fromdestination( startingpoint )
  }

  /**
   * We have sent an INVITE - which could also be 3rd party
   * @param { object } startingpoint 
   */
  #calledidforuac( startingpoint ) {
    if( !this.#fromoutentity( startingpoint ) ) {
      this.#fromcontact( startingpoint )
    }
  }


  /**
   * We have sent an INVITE - but it could be 3rd party
   * @param { object } startingpoint
   * @returns 
   */
  #calleridforuac( startingpoint ) {
    if( !this.#fromoutentity( startingpoint ) ) {
      this.#fromcontact( startingpoint )
    }
  }

  /** 
   * We have received an INVITE - so caller ID comes from headers / auth 
   * * @param { object } startingpoint
   */
  #calleridforuas( startingpoint ) {
    this.#frominentity( startingpoint )
    this.#fromremoteheaders( startingpoint )
  }

  #callerid() {
    const startingpoint = {
      "name": "",
      "uri": "",
      "user": "0000000000",
      "host": "localhost.localdomain",
      "privacy": true === this.options.privacy,
      "type": "callerid"
    }

    if( "uas" == this.type ) this.#calleridforuas( startingpoint )
    else {
      if( this.options.partycalled ) {
        this.#calleridforuac( startingpoint )
      } else {
        const other = this.other
        if( other ) {
          if( "uas" == other.type ) {
            other.#calleridforuas( startingpoint )
            other.#overridecallerid( startingpoint )
          } else {
            other.#calledidforuac( startingpoint )
          }
        } else {
          this.#calleridforuac( startingpoint )
        }
      }
    }

    this.#overridecallerid( startingpoint )
    return startingpoint
  }

  /**
   * @returns { remoteid }
   */
  get callerid() {
    return this.#callerid()
  }

  #calledid() {
    const startingpoint = {
      "name": "",
      "uri": "",
      "user": "0000000000",
      "host": "localhost.localdomain",
      "privacy": true === this.options.privacy,
      "type": "calledid"
    }

    if( "uas" == this.type ) this.#calledidforuas( startingpoint )
    else {
      if( !this.options.partycalled ) this.#calledidforuac( startingpoint )

      const other = this.other

      if( other ) {
        if( "uas" == other.type ) {
          if( this.options.partycalled ) {
            other.#calleridforuas( startingpoint )
          } else {
            other.#calledidforuas( startingpoint )
          }
        } else {
          other.#calledidforuac( startingpoint )
        }
        other.#overridecalledid( startingpoint )
      }
    }

    this.#overridecalledid( startingpoint )

    return startingpoint
  }

  /**
 * Returns the called object. i.e.
 * If we are inbound then this is the destination
 * If we are outbound then this is the entity we are calling
 * @returns { remoteid }
 */
  get calledid() {
    return this.#calledid()
  }

  /**
   * @param { string } c
   */
  set callerid( c ) {

    if( undefined == c ) return

    if( !this.options.callerid ) this.options.callerid = {}
    if( !this.options.callerid.number ) this.options.callerid.number = ""

    this.options.callerid.number = c
  }

  /**
   * @param { string } c
   */
  set calleridname( c ) {

    if( undefined == c ) return

    if( !this.options.callerid ) this.options.callerid = {}
    if( !this.options.callerid.name ) this.options.callerid.name = ""

    this.options.callerid.name = c
  }

  /**
   * @param { string } c
   */
  set calledid( c ) {

    if( !this.options.calledid ) this.options.calledid = {}
    if( !this.options.calledid.number ) this.options.calledid.number = ""
    if( !this.options.calledid.name ) this.options.calledid.name = ""

    this.options.calledid.number = c
  }

  /**
   * @param { string } c
   */
  set calledidname( c ) {

    if( !this.options.calledid ) this.options.calledid = {}
    if( !this.options.calledid.number ) this.options.calledid.number = ""
    if( !this.options.calledid.name ) this.options.calledid.name = ""

    this.options.calledid.name = c
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
    @return { boolean } - true if the call has media (i.e. is established on not held).
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
    @return { boolean } - true if the call has been trying.
  */
  get trying() {
    return this.state.trying
  }

  /**
    ringing
    @return { boolean } - true if the call has been ringing.
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
    @param { boolean } s - true if the call has been established.
  */
  set established( s ) {
    if( this.state.established != s ) {
      this.epochs.answerat = Math.floor( +new Date() / 1000 )
      this.state.established = s
    }
  }

  /**
    established
    @return { boolean } - true if the call has been established.
  */
  get established() {
    return this.state.established
  }

  /**
    @summary canceled - if the call isn't already canceled then set the endat time.
    @type { boolean }
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
    @param { boolean } s - true if the call has been destroyed.
  */
  set destroyed( s ) {
    if( this.state.destroyed != s ) {
      this.epochs.endat = Math.floor( +new Date() / 1000 )
      this.state.destroyed = s
    }
  }

  /**
    destroyed
    @return { boolean } - true if teh call has been destroyed.
  */
  get destroyed() {
    return true == this.state.destroyed
  }

  get destroyedcancelledorhungup() {
    return this.state.destroyed || this.state.canceled || this._state._hangup
  }

  /**
    @summary the current state of the call as a string: trying|proceeding|early|confirmed|terminated
    @return { string }
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
    @return { number } - the number of seconds between now (or endat if ended) and the time the call was started.
  */
  get duration() {
    if( 0 !== this.epochs.endat ) return this.epochs.endat - this.epochs.startat
    return Math.floor( +new Date() / 1000 ) - this.epochs.startat
  }

  /**
    Get the estrablished time.
    @return { number } - the number of seconds between now (or endat if ended) and the time the call was answered.
  */
  get billingduration() {
    if( 0 === this.epochs.answerat ) return 0
    if( 0 !== this.epochs.endat ) return this.epochs.endat - this.epochs.answerat
    return Math.floor( +new Date() / 1000 ) - this.epochs.answerat
  }


  /**
   * Callback for events we pass back to inerested parties.
   * Registers an event callback for this specific call. An event sink registered
   * on this member will receive events only for this call. We emit on call specific
   * emitter and a global emitter.
   * @param { string } ev - The contact string for registered or other sip contact
   * @param { (...args: any[] ) => void } cb
   */
  on( ev, cb ) {
    this._em.on( ev, cb )
  }

  /**
   * See event emitter once
   * @param { string } ev - The contact string for registered or other sip contact
   * @param { (...args: any[] ) => void } cb
   */
  once( ev, cb ) {
    this._em.once( ev, cb )
  }

  /**
   * See event emitter off
   * @param { string } ev - The contact string for registered or other sip contact
   * @param { (...args: any[] ) => void } cb
   */
  off( ev, cb ) {
    if( !cb ) {
      this._em.removeAllListeners( ev )
      return
    }
    
    this._em.off( ev, cb )
  }

  /**
   * See event emitter removeAllListeners
   * @param { string } [ ev ] - The contact string for registered or other sip contact
   */
  removealllisteners( ev ) {
    if( !ev ) {
      const evnames = this._em.eventNames()
      for( const evname of evnames ) {
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
    @param { any } argv1
  */
  emit( ev, argv1 ) {
    if( argv1 ) return this._em.emit( ev, argv1 )
    else return this._em.emit( ev, this )
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
  Emitted when a call is answered
  @event call.updated
  @type {call}
  */

  /**
  Emitted when a call is mixed with another call (not after unhold as this has it's own event)
  @event call.mix
  @type {call}
  */

  /**
  Emitted when a call is authed
  @event call.auth.start
  @type { object }
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
  @return { call }
  */
  pick() {
    this.state.picked = true
    this._em.emit( "call.pick", this )
    return this
  }

  /**
    Delink calls logically - any calls which have parent or children they are all removed.
    when the dialog is either answered (or doesn't answer for some reason).
    The promise resolves to a new call is one is generated, or undefined if not.
    @return { call }
  */
  detach() {
    if( this.parent ) {
      this.parent.children.delete( this )
    }

    for( const child of this.children ) {
      child.parent = false
    }

    this.parent = undefined
    this.children.clear()
    return this
  }

  /**
  * Logically adopt a child call
  * @param { object } other 
  * @param { boolean } [ mix ]
  * @return { call }
  */
  adopt( other, mix ) {
    other.parent = this
    this.children.add( other )
    other.moh = this.moh

    /* maintain privacy */
    other.options.privacy = this.options.privacy

    if( mix ) {
      this.channels.audio.mix( other.channels.audio )

      this._em.emit( "call.mix", this )
      callmanager.options.em.emit( "call.mix", this )
      other._em.emit( "call.mix", other )
      callmanager.options.em.emit( "call.mix", other )

      this.epochs.mix = Math.floor( +new Date() / 1000 )
      other.epochs.mix = Math.floor( +new Date() / 1000 )
    }
    return this
  }

  /**
   * Create a bond between us and another call. This is currently only used
   * to provide other channels we know we might need to open a channel on 
   * the same node as. (replaces preferredcall)
   * @param { object } relative 
   * @return { call }
   */
  bond( relative ) {
    if( !relative ) return this
    this.relatives.add( relative )
    return this
  }

  /**
   * Disown distant relatives.
   * @return { call }
   */
  disown() {
    this.relatives.clear()
    return this
  }

  /**
    Called from newuac when we receive a 180
    @private
  */
  _onring() {
    if( this.state.ringing ) return
    this.state.ringing = true
    if( undefined !== this.parent ) {
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

  async #answerparent() {
    if( this.parent ) {
      if( !this.parent.established ) {
        try {
          await this.parent.answer()
        } catch( e ) {
          console.trace( e )
        }
  
        if( !this.parent.established ) {
          return this.hangup( hangupcodes.USER_GONE )
        }
      }
  
      /* are we still established? */
      if( !this.established || this.state.destroyed ) return this
      if( !this.channels.audio ) {
        /* something bad has happened */
        this.hangup( hangupcodes.NOT_ACCEPTABLE )
        return this
      }

      this.channels.audio.mix( this.parent.channels.audio )

      this._em.emit( "call.mix", this )
      callmanager.options.em.emit( "call.mix", this )
      this.parent._em.emit( "call.mix", this.parent )
      callmanager.options.em.emit( "call.mix", this.parent )

      this.epochs.mix = Math.floor( +new Date() / 1000 )
      if( this.parent ) this.parent.epochs.mix = Math.floor( +new Date() / 1000 )
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

    if( !this.sdp.remote.intersection( this.options.preferedcodecs, true ) ) {
      return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )
    }

    this.sdp.remote.setdynamepayloadtypes( this.sdp.local )

    const channeldef = await this.#createchannelremotedef()
    if( !channeldef )
      return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )

    this.channels.audio.remote( channeldef.remote )
    await this.#answerparent()
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

    if ( this._dialog.res )
      this.sdp.remote = sdpgen.create( this._dialog.res.msg.body )
    else
      this.sdp.remote = sdpgen.create( this._req.msg.body )

    const selectedcodec = this.sdp.remote.intersection( this.options.preferedcodecs, true )
    if( !selectedcodec ) {
      return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )
    }

    const channeldef = await this.#createchannelremotedef()
    if( !channeldef )
      return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )

    if ( this.channels.audio )
      this.channels.audio.destroy()

    await this.#openrelatedchannel( channeldef )

    this.sdp.local = sdpgen.create()
      .addcodecs( selectedcodec )
      .setconnectionaddress( this.channels.audio.local.address )
      .setaudioport( this.channels.audio.local.port )
      .setdynamepayloadtypes( this.sdp.remote )

    if( true === this.options.rfc2833 ) {
      this.sdp.local.addcodecs( "2833" )
    }

    if( this._iswebrtc ) {
      const ch = this.channels.audio
      this.sdp.local.addssrc( ch.local.ssrc )
        .secure( ch.local.dtls.fingerprint, channeldef.remote.dtls.mode )
        .addicecandidates( ch.local.address, ch.local.port, ch.local.icepwd )
        .rtcpmux()
    }

    this.#setdialog( await this._dialog.ack( this.sdp.local.toString() ) )
    this._addevents( this._dialog )

    await this.#answerparent()

    return this
  }

  /**
    Sometimes we don't care who if we are the parent or child - we just want the other party
    @return { object | boolean } returns call object or if none false
  */
  get other() {
    if( this.parent ) return this.parent
    return this.child
  }

  /**
   * Return specifically first child - prefer established otherwise first
   */
  get child() {
    /* first established */
    for( const child of this.children ) {
      if( child.established ) {
        return child
      }
    }

    /* or the first */
    if( 0 < this.children.size ) return this.children.values().next().value

    return false
  }

  /**
    auth - returns promise. This will force a call to be authed by a client. If the call
    has been refered by another client that has been authed this call will assume that auth.
    @todo check refering call has been authed
    @return { Promise } Returns promise which resolves on success or rejects on failed auth. If not caught this framework will catch and cleanup.
  */
  async auth() {

    if( undefined === callmanager.options.userlookup ) { 
      console.trace( "no userlookup function provided" )
      return
    }

    /* we have been requested to auth - so set our state to unauthed */
    this.state.authed = false

    if( this._auth.has( this._req ) ) {
      /* If the client has included an auth header check it immediatly */
      if( this._onauth( this._req, this._res ) ) return
    }

    this._timers.auth = setTimeout( () => {
      this._promises.reject.auth( new SipError( hangupcodes.REQUEST_TIMEOUT, "Auth timed out" ) )
      this._promises.resolve.auth = undefined
      this._promises.reject.auth = undefined
      this._timers.auth = undefined

      this.hangup( hangupcodes.REQUEST_TIMEOUT )

    }, 50000 )

    const authpromise = new Promise( ( resolve, reject ) => {
      this._promises.resolve.auth = resolve
      this._promises.reject.auth = reject
    } )

    const e = await this.entity
    let authrealm
    if( e ) authrealm = e.realm
    /* Fresh auth */
    this._auth = sipauth.create( callmanager.options.proxy )
    this._auth.requestauth( this._req, this._res, authrealm )

    await authpromise

  }

  /**
    Called by us we handle the auth challenge in this function
    @private
  */
  async _onauth( req, res ) {

    this._req = req
    this._res = res

    req.on( "cancel", ( /*req*/ ) => this._oncanceled( /*req*/ ) )

    if( !this._auth.has( this._req ) ) return false

    const authorization = this._auth.parseauthheaders( this._req )
    const user = await callmanager.options.userlookup( authorization.username, authorization.realm )
    this._em.emit( "call.auth.start", { call: this, user } )
    callmanager.options.em.emit( "call.auth.start", { call: this, user } )

    if( !user || !this._auth.verifyauth( this._req, authorization, user.secret ) ) {

      if( this._auth.stale ) {
        const e = await this.entity
        let authrealm
        if( e ) authrealm = e.realm
        this._auth.requestauth( this._req, this._res, authrealm )
        return false
      }

      this._em.emit( "call.authed.failed", this )
      callmanager.options.em.emit( "call.authed.failed", this )

      await this.hangup( hangupcodes.FORBIDDEN )

      const reject = this._promises.reject.auth
      this._promises.resolve.auth = undefined
      this._promises.reject.auth = undefined

      clearTimeout( this._timers.auth )
      this._timers.auth = undefined

      if( reject ) reject( new SipError( hangupcodes.FORBIDDEN, "Bad Auth" ))

      return false
    }

    clearTimeout( this._timers.auth )
    this._timers.auth = false

    this._entity = {
      "username": authorization.username,
      "realm": authorization.realm,
      "uri": authorization.username + "@" + authorization.realm,
      "display": !user.display?"":user.display
    }

    this.state.authed = true
    await callstore.set( this )

    const resolve = this._promises.resolve.auth
    this._promises.resolve.auth = undefined
    this._promises.reject.auth = undefined
    this._timers.auth = undefined
    if( resolve ) resolve()

    this._em.emit( "call.authed", this )
    callmanager.options.em.emit( "call.authed", this )

    return this.state.authed
  }

  /**
    Called by us to handle call cancelled
    @private
  */
  _oncanceled( /*req, res*/ ) {
    this.canceled = true

    for( const child of this.children ) {
      child.hangup( hangupcodes.ORIGINATOR_CANCEL )
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
      const ourmatch = this._receivedtelevents.match( this.eventmatch )
      if( null !== ourmatch ) {

        delete this.eventmatch
        this._receivedtelevents = this._receivedtelevents.slice( ourmatch[ 0 ].length + ourmatch.index )

        if( this._promises.resolve.events ) {
          const r = this._promises.resolve.events
          
          this._promises.resolve.events = undefined
          this._promises.promise.events = undefined
          r( ourmatch[ 0 ] )
        }

        if( this._timers.events ) {
          clearTimeout( this._timers.events )
          this._timers.events = undefined
        }
      }
    }
  }

  /**
    Called by our call plan to wait for events for auto attendant/IVR.
    @param { string | RegExp } [match] - reg exp matching what is required from the user.
    @param { number } [timeout] - time to wait before giving up.
    @return { Promise } - the promise either resolves to a string if it matches or undefined if it times out..
  */
  waitfortelevents( match = /[0-9A-D*#]/, timeout = 30000 ) {

    if( this.destroyed ) throw Error( "Call already destroyed" )
    if( this._promises.promise.events ) return this._promises.promise.events

    this._promises.promise.events = new Promise( ( resolve ) => {

      this._timers.events = setTimeout( () => {

        if( this._promises.resolve.events ) {
          this._promises.resolve.events()
        }

        this._promises.resolve.events = undefined
        this._promises.promise.events = undefined
        this._timers.events = undefined
        delete this.eventmatch

      }, timeout )

      if( "string" === typeof match ){
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

  /**true
    Shortcut to hangup with the reason busy.
  */
  busy() {
    this.hangup( hangupcodes.USER_BUSY )
  }

  /**
   * @private
   */
  get _iswebrtc() {

    /* Have we received remote SDP? */
    if( this.sdp.remote ) {
      return this.sdp.remote.sdp.media[ 0 ] &&
            -1 !== this.sdp.remote.sdp.media[ 0 ].protocol.toLowerCase().indexOf( "savpf" ) /* 'UDP/TLS/RTP/SAVPF' */
    }

    if( !this.options || !this.options.contact ) return false
    return -1 !== this.options.contact.indexOf( ";transport=ws" )

  }

  /**
   * 
   * @param { object } channeldef 
   */
  async #openchannelsforanswer( channeldef ) {
    if( this.channels.audio ) {
      /* we have already opened a channel (probably early now answering) */
      this.channels.audio.remote( channeldef.remote )
    } else {

      await this.#openrelatedchannel( channeldef )

      this.sdp.local = sdpgen.create()
        .addcodecs( this.sdp.remote.selected.name )
        .setconnectionaddress( this.channels.audio.local.address )
        .setaudioport( this.channels.audio.local.port )
        .setdynamepayloadtypes( this.sdp.remote )

      this.#checkandadd2833()

      if( this._iswebrtc ) {
        this.sdp.local.addssrc( this.channels.audio.local.ssrc )
          .secure( this.channels.audio.local.dtls.fingerprint, channeldef.remote.dtls.mode )
          .addicecandidates( this.channels.audio.local.address, this.channels.audio.local.port, this.channels.audio.local.icepwd )
          .rtcpmux()
      }
    }
  }

  /**
   * that can be used to open the new channel's node.
   *
   * @returns { Promise }
   */
  async #choosecodecforanswer() {
    if( this._req.msg && this._req.msg.body ) {

      if( !this.sdp.remote.intersection( this.options.preferedcodecs, true ) ) {
        return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )
      }

      const channeldef = await this.#createchannelremotedef()
      if( !channeldef )
        return this.hangup( hangupcodes.INCOMPATIBLE_DESTINATION )

      /* We might have already opened our audio when we received 183 (early). */
      await this.#openchannelsforanswer( channeldef )
    }
  }

  /**
   * Answer this (inbound) call and store a channel which can be used. This framework will catch and cleanup this call if this is rejected.
   * @param { object } [ options ]
   * @param { boolean } [ options.early ] - don't answer the channel (establish) but establish early media (respond to 183).
   *
   * @return {Promise} Returns a promise which resolves if the call is answered, otherwise rejects the promise.
  */
  async answer( options = { early: false } ) {

    if( this.canceled || this.established ) return

    await this.#choosecodecforanswer()

    if( this.canceled ) return

    if( options.early ) {
      this.state.early = true
      this._em.emit( "call.early", this )
      callmanager.options.em.emit( "call.early", this )
    } else {
      const dialog = await callmanager.options.srf.createUAS( this._req, this._res, {
        localSdp: this.sdp.local.toString(),
        headers: {
          "User-Agent": "project",
          "Supported": "replaces"
        }
      } )

      this.#setdialog( dialog )
      this.sip.tags.local = dialog.sip.localTag
      callstore.set( this )

      this._addevents( this._dialog )
      this._em.emit( "call.answered", this )
      callmanager.options.em.emit( "call.answered", this )

    }
  }

  #handlechannelevclose( e ) {
    /* keep a record */
    if( this.channels.audio.history ) {
      this.channels.closed.audio.push( this.channels.audio.history )
    } else {
      this.channels.closed.audio.push( e )
    }

    this.channels.count--

    if ( 0 === this.channels.count ) {
      this.channels.audio = undefined

      if( this._state._onhangup ) {
        this._cleanup()
        return
      }

      // This will handle _cleanup() later
      // based on the above flag
      this.hangup()
    }
  }

  /**
   * 
   * @param { object } e 
   * @returns 
   */
  #handlechannelwaiting( e ) {
    if( this._eventconstraints ) {
      const constraintkeys = Object.keys( this._eventconstraints )
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
    this._timers.anyevent = undefined

    const r = this._promises.resolve.channelevent
    this._promises.resolve.channelevent = undefined
    this._promises.reject.channelevent = undefined
    this._promises.promise.channelevent = undefined
    if( r ) r( e )
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

    switch( e.action ) {
    case "close":
      this.#handlechannelevclose( e )
      return
    case "telephone-event":
      this._tevent( e.event )
      break
    }

    this.#handlechannelwaiting( e )

  }

  /**
  Wait for any event of interest. DTMF or Audio (channel close, audio event etc).
  When this is extended to SIP DTMF this will be also included.

  constraints will limit the promise firing to one which matches the event we expect.
  timeout will force a firing.

  A telephone event will resolve this promise as we typically need speech to be interupted
  by the user. Note, peeking a telephone-event (i.e. DTMF) will not clear it like waitfortelevents will.
  @param { object } constraints - event to filter for from our RTP server - excluding DTMF events - these will always return
  */
  waitforanyevent( constraints, timeout = 500 ) {

    if( this.destroyed ) throw Error( "Call already destroyed" )
    if ( this._promises.promise.channelevent ) return this._promises.promise.channelevent

    this._eventconstraints = constraints

    this._promises.promise.channelevent = new Promise( ( resolve, reject ) => {
      this._promises.reject.channelevent = reject
      this._promises.resolve.channelevent = resolve
    } )

    this._timers.anyevent = setTimeout( () => {

      const r = this._promises.resolve.channelevent
      this._promises.promise.channelevent = undefined
      this._promises.resolve.channelevent = undefined
      this._promises.reject.channelevent = undefined
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
   * @param { "inactive"|"recvonly" } direction - from the other end
   * @returns { Promise } resolves on timeout or when unmix happens
   * @private
   */
  _hold( direction = "inactive" ) {

    if( this.state.held ) return
    this.state.held = true

    const ourpromises = []

    const d = { "send": false, "recv": false }
    if( "recvonly" == direction ) d.send = true

    if( this.channels.audio ) {
      this.channels.audio.unmix()
      ourpromises.push( this.waitforanyevent( { "action": "mix", "event": "finished" }, 0.5 ) )
      this.channels.audio.direction( d )
    }

    this.sdp.local.setaudiodirection( direction )

    const other = this.other
    if( other && other.channels.audio ) {
      other.channels.audio.unmix()
      ourpromises.push( other.waitforanyevent( { "action": "mix", "event": "finished" }, 0.5 ) )
      other.channels.audio.play( this.moh )
    }

    this._em.emit( "call.hold", this )
    callmanager.options.em.emit( "call.hold", this )

    return Promise.all( ourpromises )
  }

  /**
    Same as _hold.
    @private
  */
  _unhold() {
    if( !this.state.held ) return
    this.state.held = false

    if( this.channels.audio )
      this.channels.audio.direction( { "send": true, "recv": true } )
    this.sdp.local.setaudiodirection( "sendrecv" )

    const other = this.other
    if( other && other.channels.audio && this.channels.audio ) {
      this.channels.audio.mix( other.channels.audio )

      this._em.emit( "call.mix", this )
      callmanager.options.em.emit( "call.mix", this )
      other._em.emit( "call.mix", other )
      callmanager.options.em.emit( "call.mix", other )
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

    const opts = {
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

    const opts = {
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

    const opts = {
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
    Send out pre-modified SDP to get the audio to the new location.
    This method might be use, but there are problems - so when it is used
    it can be re-written but should use a mthod to create a codec - which is the 
    same as used elsewhere. If a bond has been attached to the call, we will
    try to reuse an existing channel.
    @param { object } [ channeldef ]
    @param { object } [ newchannel ]
    @private
  */
  async reinvite( channeldef, newchannel ) {

    if ( newchannel )
      this.channels.audio = newchannel

    if ( !channeldef )
      channeldef = await this.#createchannelremotedef()

    const remotesdp = await this._dialog.modify( this.sdp.local.toString() )
      .catch( ( e ) => {
        console.trace( e )
      } )
    
    if( this.destroyed ) return

    if( remotesdp ) {
      this.sdp.remote = sdpgen.create( remotesdp )
      this.sdp.remote.setdynamepayloadtypes( this.sdp.local )
    }

  }

  /**
    Mix two calls. If the two calls are on a different node
    the second call is bonded and reinvited.
    @param { call } othercall - our call object which is early
    @private
  */
  async mix( othercall ) {
    if ( othercall.channels.audio
        && othercall.channels.audio.connection.instance
          != this.channels.audio.connection.instance ) {

      const channeldef = await othercall.#createchannelremotedef()

      const oldchannel = othercall.channels.audio
      const newchannel = await this.#openchannel( channeldef, othercall )

      await othercall.bond( this ).reinvite( channeldef, newchannel )

      await oldchannel.unmix()
      oldchannel.close()
    }

    await this.channels.audio.mix( othercall.channels.audio )
  }

  /**
    Mix two calls. If the two calls are on a different node
    the second call is bonded and reinvited.
    @param { object } channeldef - our call object which is early
    @param { call } [ bindcall ] - the call which will own the channel
  */
  async #openchannel( channeldef, bindcall ) {

    let chan = undefined

    if ( !bindcall || !this.channels.audio ) {
      chan = await projectrtp.openchannel(
        channeldef, this._handlechannelevents.bind( this ) )
    } else {
      chan = await this.channels.audio.openchannel(
        channeldef, bindcall._handlechannelevents.bind( bindcall ) )
    }

    if ( bindcall )
      bindcall.channels.count++
    else
      this.channels.count++

    return chan
  }

  /**
   * 
   * @param { object } req 
   * @param { object } res 
   * @returns 
   */
  #getreferedto( req, res ) {

    if( !req.has( "refer-to" ) ) {
      res.send( 400, "Bad request - no refer-to" )
      return
    }

    const referto = req.getParsedHeader( "refer-to" )
    const parsedrefuri = parseuri( referto.uri )

    if( !parsedrefuri || !parsedrefuri.user ) {
      res.send( 400, "Bad request - no refer-to user" )
      return
    }

    if( !parsedrefuri.host ) {
      res.send( 400, "Bad request - no refer-to host" )
      return
    }

    return referto
  }

  #getsdpformodify( req ) {
    const sdp = sdpgen.create( req.msg.body )
    const media = sdp.getmedia()

    let ip
    if( sdp && sdp.sdp && sdp.sdp.connection && sdp.sdp.connection.ip ) {
      ip = sdp.sdp.connection.ip
    }

    return { media, ip }
  }

  /**
   * We receive a modify to a dialgue (re-invite) and it looks like a hold
   * @param { string } direction 
   * @param { object } res 
   * @returns { boolean }
   */
  #handlehold( direction, res ) {

    if( "inactive" !== direction && "sendonly" !== direction ) return false

    if( "sendonly" === direction ) this._hold( "recvonly" )
    else this._hold( direction )

    res.send( 200, {
      "headers": {
        "Subject" : "Call on hold",
        "User-Agent": "project",
        "Allow": "INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY",
        "Supported": "replaces"
      },
      "body": this.sdp.local.toString()
    } )

    return true
  }

  /**
   * We receive a request to unhold.
   * @param { string | undefined } direction undefined is the same as "sendrecv"
   * @param { object } res 
   * @returns { boolean }
   */
  #handleoffhold( direction, res ) {
    if( direction && "sendrecv" !== direction ) return false

    this._unhold()
    res.send( 200, {
      "headers": {
        "Subject" : "Call off hold",
        "User-Agent": "project"
      },
      "body": this.sdp.local.toString()
    } )

    return true
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

      try{

        if( this.destroyed ) {
          /* this should be done - but we are still running */
          clearInterval( this._timers.seinterval )
          return
        }

        if( "function" != typeof dialog.request ) return

        const opts = {
          "method": "INVITE",
          "body": this.sdp.local.toString()
        }
  
        const res = await dialog.request( opts )
          .catch( ( e ) => {
            console.trace( e )
            this.hangup( hangupcodes.USER_GONE )
          } )
  
        if( !this.destroyed && 200 != res.msg.status ) {
          this.hangup( hangupcodes.USER_GONE )
        }
      } catch( e ) { /* empty */ }

    }, callmanager.options.seexpire )

    dialog.on( "destroy", ( /* req */ ) => {
      if( this._state._hangup ) return
      this._onhangup( "wire" )
    } )

    dialog.on( "info", async ( req, res ) => {
      if( "application/dtmf-relay" === req.get( "Content-Type" ).toLowerCase() &&
            0 < parseInt( req.get( "content-length" ) ) ) {

        const matches = req.msg.body.match( /Signal=(.+?)/i )
        if( !matches || !Array.isArray( matches ) || 2 > matches.length ) return res.send( 415, "Badly formated SIP INFO" )

        const digit = matches[ 1 ]
        this._tevent( digit )
        const other = this.other
        if( other && other.channels.audio ) {
          other.channels.audio.dtmf( digit )
        }

        try {
          this._em.emit( "channel", { "call": this, "event": { action: "telephone-event", event: digit, source: "sip-info" } } )
        } catch ( e ) { console.trace( e ) }

        return res.send( 200 )
      }
      
      return res.send( 415, "Unsupported Media Type" )
    } )

    dialog.on( "modify", ( req, res ) => {
      //  The application must respond, using the res parameter provided.
      if( "INVITE" !== req.msg.method ) return

      const sdp = this.#getsdpformodify( req )

      /* this was tested against jssip - which I don't think is correct. It was sending us
      sendonly when placing the call on hold. It didn't change the connection IP (although it did set the rtcp connection ip to 0.0.0.0!). */
      let d = sdp.media.direction
      if( "0.0.0.0" === sdp.ip ) d = "inactive"
      if( this.#handlehold( d, res ) ) return
      if( this.#handleoffhold( d, res ) ) return

      /* Unknown - but respond to keep the call going */
      res.send( 200, {
        "headers": {
          "Subject" : "Ok",
          "User-Agent": "project"
        },
        "body": this.sdp.local.toString()
      } )

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
          if( this._auth.has( this._req ) ) {
            /* If the client has included an auth header check it immediatly */
            if( ! await this._onauth( this._req, this._res ) ) return
          } else {
            await this.auth()
          }

          if( this.destroyed ) return
        }

        const referto = this.#getreferedto( req, res )
        if( !referto ) return

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
        const replacesuri = decodeURIComponent( referto.uri )
        const replaces = replacesuri.match( /replaces=(.*?)(;|$)/i )

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
      const othercall = this.other
      if( !othercall ) return res.send( 400, "We have no-one to refer" )

      othercall.state.refered = true

      this.detach()

      this._unhold()
      othercall._unhold()

      const ourpromises = []
      if( this.channels.audio ) {
        this.channels.audio.unmix()
        ourpromises.push( this.waitforanyevent( { "action": "mix", "event": "finished" }, 0.5 ) )
      }
      if( othercall.channels.audio ) {
        othercall.channels.audio.unmix()
        ourpromises.push( othercall.waitforanyevent( { "action": "mix", "event": "finished" }, 0.5 ) )
      }

      await Promise.all( ourpromises )

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
  // We might break this function up in the future, but for now it is a complex
  // process - so ignore for now.
  // eslint-disable-next-line complexity
  async _runattendedxfer( req, res, replaces, replacesuri ) {
    const totag = replacesuri.match( /to-tag=(.*?)(;|$)/i )
    const fromtag = replacesuri.match( /from-tag=(.*?)(;|$)/i )

    if( 3 > replaces.length || 3 > totag.length || 3 > fromtag.length ) {
      res.send( 400, "Bad call reference for replaces" )
      return
    }

    let b_1
    try {
      const searchfor = { "callid": replaces[ 1 ], "tags": { "local": totag[ 1 ], "remote": fromtag[ 1 ] } }
      b_1 = await callstore.getbycallid( searchfor )
    } catch( e ) {
      console.trace( e )
      res.send( 400, e )
      return
    }

    if( !b_1 ) return res.send( 400, "No call matches that call id" )
    if( !b_1.sdp.remote ) return res.send( 400, "No remote sdp negotiated (b_1)!" )
    const b_2 = this /* so we can follow the above terminology */

    let c_1 = b_2.other
    if( !c_1 ) c_1 = b_2

    const a_1 = b_1.other
    if( !a_1 ) return res.send( 400, "Can't attened xfer 1 legged calls" )
    if( !a_1.sdp.remote ) return res.send( 400, "No remote sdp negotiated (a_1)!" )

    if( !a_1.channels.audio ) return res.send( 400, "No channel (a_1)" )
    if( !b_1.channels.audio ) return res.send( 400, "No channel (b_1)" )
    if( !b_2.channels.audio ) return res.send( 400, "No channel (b_2)" )
    if( !c_1.channels.audio ) return res.send( 400, "No channel (c_1)" )

    b_1.detach()
    b_2.detach()

    await Promise.all( [ 
      a_1._unhold(),
      b_1._unhold(),
      b_2._unhold(),
      c_1._unhold() ] )

    a_1.channels.audio.unmix()
    b_1.channels.audio.unmix()
    b_2.channels.audio.unmix()
    c_1.channels.audio.unmix()

    await Promise.all( [
      a_1.waitforanyevent( { "action": "mix", "event": "finished" }, 0.5 ),
      b_1.waitforanyevent( { "action": "mix", "event": "finished" }, 0.5 ),
      b_2.waitforanyevent( { "action": "mix", "event": "finished" }, 0.5 ),
      c_1.waitforanyevent( { "action": "mix", "event": "finished" }, 0.5 ),
    ] )

    await new Promise( ( resolve ) => {
      res.send( 202, "Refering", {}, ( /* err, response */ ) => {
        resolve()
      } )
    } )

    /*
    TODO - this is wrong. If we want to include this - it is not the REFER CSEQ that jssip
    is looking for - it is the cseq of the INVITE.
    const id = this._req.get( "cseq" ).match( /(\d+)/ )[ 0 ]
    Leave out for now - as this works for us.
    */
    try {
      await this._notifyreferstart()
    } catch( e ) {
      console.trace( e )
      this._notifyreferfail()
      return
    }

    /* Link logically and mix */
    a_1.adopt( c_1, true )

    this._notifyrefercomplete()

    a_1.state.refered = true

    this.hangup_cause = Object.assign( { "src": "wire" }, hangupcodes.ATTENDED_TRANSFER )
    b_1.hangup( hangupcodes.ATTENDED_TRANSFER )
  }

  /**
   * Obtain IP address from SDP - including looking at candidates if required
   * @param { boolean } parsecandidates - check the candidates in sdp also
   * @returns { Promise< object | undefined  > }
   */
  async #getremotetarget( parsecandidates ) {

    const target = this.sdp.remote.getaudio()
    if( !target ) return
    if( !parsecandidates ) return target

    const sdp = this.sdp.remote.sdp

    if( Array.isArray( sdp.media[ 0 ].candidates ) ) {
      let candidates = sdp.media[ 0 ].candidates
      if( 0 < candidates.length ) {
        if( callmanager.options.ignoreipv6candidates ) {
          candidates = candidates.filter( ( c ) => { 
            const ismatch = ipv6regex.test( c.ip )
            return !ismatch
          } )
        }

        candidates.sort( ( l, r ) => { return r.priority - l.priority } )
        target.port = candidates[ 0 ].port

        await new Promise( ( resolve ) => {
          dns.lookup( candidates[ 0 ].ip, ( err, result ) => {
            if( !err ) target.address = result
            resolve()
          } )
        } )
      }
    }

    return target
  }

  /**
   * Returns and object we can pass into an openchannel function, 
   * { remote: {} } - the remote can be passed into set remote on
   * an already open channel.
   * @returns { Promise< object | undefined > }
   */
  async #createchannelremotedef() {

    const iswebrtc = this._iswebrtc
    const target = await this.#getremotetarget( iswebrtc )

    if( !target ) return
    const address = target.address
    const port = target.port

    const codec = this.sdp.remote.selected
    if( !codec ) return

    const chandef = {
      "remote": { address, port, codec: codec.pt }
    }

    /* dynamic payload types */
    const dpts = this.sdp.remote.getdynamicpayloadtypes()
    if( "rfc2833" in dpts ) chandef.remote.rfc2833pt = dpts.rfc2833.payload
    if( "ilbc" in dpts ) chandef.remote.ilbcpt = dpts.ilbc.payload

    if( iswebrtc ) {

      const hash = this.sdp.remote.sdp.media[ 0 ].fingerprint.hash
      let mode = "active"
      if( "active" == this.sdp.remote.sdp.media[ 0 ].setup ) mode = "passive" /* act|pass|actpass */
  
      if( hash ) {
        chandef.remote.dtls = {
          "fingerprint": { hash },
          mode
        }
      }
    }
    return chandef
  }

  /**
  Sets our hangup cause correctly - if not already set.
  @param { string } src
  @param { object } [ reason ]
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
      this._timers[ key ] = undefined
    }

    const authreject = this._promises.reject.auth
    this._promises.reject.auth = undefined
    this._promises.resolve.auth = undefined
    if( authreject ) authreject( new SipError( hangupcodes.REQUEST_TIMEOUT, "Auth timed out (cleanup)" ) )

    const chanev = this._promises.resolve.channelevent
    this._promises.resolve.channelevent = undefined
    this._promises.reject.channelevent = undefined
    this._promises.promise.channelevent = undefined
    if( chanev ) chanev()

    const resolves = []
    for ( const [ key, value ] of Object.entries( this._promises.resolve ) ) {
      if( value ) resolves.push( value )
      this._promises.resolve[ key ] = undefined
    }

    /* Call outstanding resolves for promises - this will trigger out hangup promise also */
    resolves.forEach( r => r( this ) )

    callstore.delete( this ).then( () => {
      this._em.emit( "call.destroyed", this )
      callmanager.options.em.emit( "call.destroyed", this )
  
      this._em.emit( "call.reporting", this )
      callmanager.options.em.emit( "call.reporting", this )

      this.removealllisteners()
      return 0
    } ).catch( () => {} )
  }

  /**
   * Used by our frame to a) continue a hangup which has been initiated by either us or the network.
   * Complete the hangup, including hanging up all children and waiting for them to complete their
   * hangup.
   * @param { string } [ src ] - "us"|"wire"
   * @param { object } [ reason ] - one of the reasons from the hangupcodes enum - only used if we havn't alread set our reason
   * @private
  */
  async _onhangup( src = "us", reason ) {

    if( this._state._onhangup ) {
      await this.waitforhangup()
      return
    }
    this._state._onhangup = true

    /* hangup our children but, no other relations - i.e. children of our parent */
    const hangups = []
    for( const child of this.children ) {
      hangups.push( child.hangup( this.hangup_cause ) )
    }

    /* wait for all children to have completed their hangup */
    if( 0 < hangups.length ) {
      await Promise.all( hangups )
    }

    this._sethangupcause( src, reason )

    /* flag destroyed so when we receive our close event we know what to do */
    this.destroyed = true
    if( this.channels.audio ) {
      this.channels.audio.close()
      this._timers.cleanup = setTimeout( () => {
        console.trace( this.uuid + " Timeout waiting for channel close, cleaning up anyway, chan uuid: " + this.channels.audio.uuid + ", channel count: " + this.channels.count )
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
    this._sethangupcause( "us", reason )

    if( this.state.established ) {
      try {
        await this._dialog.destroy()
      } catch( e ) { console.trace( e ) }

    } else if( "uac" === this.type && 
               this.state.trying ) {
      try {
        this.canceled = true
        if( this._req ) {
          this._req.cancel( ( err /*, cancel */ ) => {
            if( err ) console.trace( err )
          } )
        }
      } catch( e ) { console.trace( e ) }
    } else if( this._res ) {
      this._res.send( this.hangup_cause.sip )
    }

    await this._onhangup( "us", reason )
  }

  /**
   * 
   * @returns { Promise }
   */
  async waitforhangup() {

    if( !this._promises.promise.hangup ) {
      return
    }

    await this._promises.promise.hangup
    this._promises.promise.hangup = undefined
    this._promises.resolve.hangup = undefined

  }

  /**
  * Send an UPDATE. Use to updated called id, caller id, sdp etc. Send in dialog - TODO look how to send
  * early as this is recomended in the RFC.
  */
  async update( remote ) {

    /* if we are asked to update it suggests we have received new information and overrides should go */
    delete this.options.callerid
    delete this.options.calledid

    if( remote ) {
      if( remote.callerid ) {
        this.callerid = remote.callerid.number
        this.calleridname = remote.callerid.name
      }
    }

    this._em.emit( "call.updated", this )
    callmanager.options.em.emit( "call.updated", this )

    if( !this._dialog ) {
      console.trace( "Early update not currently supported" )
      return false
    }

    /* Check client supports update */
    if( !this._allow ) return false
    if( !/\bupdate\b/i.test( this._allow ) ) return false

    const requestoptions = {}
    requestoptions.method = "UPDATE"
    if( this.sdp.local ) {
      requestoptions.body = this.sdp.local.toString()
    }

    this.#configcalleridfornewuac()

    this._dialog.request( { ...this.options, ...requestoptions } )

    return true
  }



  /**
   * @summary Creates a new SIP dialog. Returns a promise which resolves
   * when the dialog is either answered (or cancelled for some reason).
   * The promise resolves to a new call is one is generated, or undefined if not.
   * @param { calloptions } [ options ] - Options object. See default_options in index.js for more details.
   * @param { newuaccallbacks } [ callbacks ]
   * @return { Promise< call | false > } - returns a promise which resolves to a new call object if a dialog has been confirmed. If none are confirmed ten return false. Each attempt is fed into callbacks.early.
   */
  async newuac( options, callbacks = {} ) {

    /* If max-forwards is not specified then we decrement the parent and pass on */
    if( !( "headers" in options ) ) options.headers = {}

    let maxforwards = 70
    if( !options.headers[ Object.keys( options.headers ).find( key => "max-forwards" === key.toLowerCase() ) ] ) {
      if( this._req.has( "Max-Forwards" ) ) {
        maxforwards = parseInt( this._req.get( "Max-Forwards" ) ) - 1
        if( isNaN( maxforwards ) || 0 >= maxforwards ) return false
      }
    }

    options.headers[ "max-forwards" ] = maxforwards
    
    if( !options.orphan && !options.parent ) {
      options.parent = this
    }

    return await call.newuac( options, callbacks )
  }

  static async #checkmaxcallsforentity( options ) {
    /* We check call count early - so we can call multiple registrations */
    if( options.entity && options.entity.max ) {
      if( !options.entity.uri ) {
        options.entity.uri = options.entity.username + "@" + options.entity.realm
      }

      const cs = await callstore.getbyentity( options.entity.uri )
      if( cs && cs.size >= options.entity.max ) {
        return false
      }
    }
    return true
  }

  static async #sanityforcallcontact( options ) {

    if( !( await call.#checkmaxcallsforentity( options ) ) ) return false

    /* If we have an entity - we need to look them up */
    if( !callmanager.options.registrar ) return false
    if( !options.entity ) return false

    const contactinfo = await callmanager.options.registrar.contacts( options.entity )
    if( 0 == contactinfo.contacts.length )
      return false

    if( options.first )
      contactinfo.contacts = [ contactinfo.contacts[ 0 ] ]

    return contactinfo
  }
  
  /**
   * 
   * @returns { Promise< boolean | object > }
   */
  static async #callcontactfornewuac( options, callbacks ) {

    const contactinfo = await call.#sanityforcallcontact( options )
    if( !contactinfo ) {
      if( callbacks.fail ) callbacks.fail()
      return false
    }

    let numcontacts = 0
    const ourcallbacks = {}
    let failcount = 0

    let waitonchildrenresolve
    const waitonchildrenpromise = new Promise( ( resolve ) => {
      waitonchildrenresolve = resolve
    } )

    ourcallbacks.early = ( c ) => {
      if( callbacks.early ) callbacks.early( c )
    }

    ourcallbacks.fail = ( c ) => {
      failcount++
      if( failcount >= numcontacts ) {
        /* we have no more to try */
        if( false !== waitonchildrenresolve ) {
          waitonchildrenresolve( false )
          waitonchildrenresolve = false
        }
      }
      if( callbacks.fail ) callbacks.fail( c )
    }

    ourcallbacks.prebridge = ( c ) => {
      if( callbacks.prebridge ) return callbacks.prebridge( c )
    }

    ourcallbacks.confirm = ( /** @type { call } */ c, /** @type { any } */ cookie ) => {
      if( false !== waitonchildrenresolve ) {
        waitonchildrenresolve( c )
        waitonchildrenresolve = false
        if( callbacks.confirm ) callbacks.confirm( c, cookie )
      }
    }

    for( const contact of contactinfo.contacts ) {
      if( undefined === contact ) continue
      const newoptions = { ...options }
      
      if( contact.contact && "string" == typeof contact.contact ) {
        numcontacts++
        newoptions.contact = contact.contact
        call.newuac( newoptions, ourcallbacks )
      }
    }

    if( 0 == numcontacts ) {
      if( callbacks.fail ) callbacks.fail()
      return false
    }

    const child = await waitonchildrenpromise
    return child
  }

  /**
   * If any of our one of our related calls has a channel open
   * try and use it. NB (other favours the answered if not then the first)
   * It will use the channel on that call.
   * @param { object } [ channeldef ]
   */
  async #openrelatedchannel( channeldef ) {

    if( this.channels.audio ) return

    const relatedcall = this.other
    /* TODO: this is a hack. projectrtp has become too complicated with both a listen and connect 
    mechanism. This is causing problems in code like this. There is no interface to 
    detect which mode the channel is in - but the channels property will exist on a connect
    style channel. projectrtp will getrelatives a rewrite to support only one. */
    if( relatedcall && relatedcall.channels.audio && relatedcall.channels.audio.channels ) {
      this.channels.audio = await this.#openchannel( channeldef, this )
      return
    }

    for( const other of this.relatives ) {
      if( other.channels && other.channels.audio ) {
        this.channels.audio = await other.#openchannel( channeldef, this )
        return
      }
    }

    this.channels.audio = await this.#openchannel( channeldef )
  }

  /**
   * If we have remote sdp we have to check they support 2833 before we add backand our options permit it.
   * If we have no remote sdp then we only check our options.
   */
  #checkandadd2833() {
    if( this.sdp.remote ) {
      if( this.options.rfc2833 && this.sdp.remote.has( "2833" ) ) {
        this.sdp.local.addcodecs( "2833" )
      }
    } else if( this.options.rfc2833 ) {
      this.sdp.local.addcodecs( "2833" )
    }
  }

  /**
   * 
   */
  async #openchannelsfornewuac( channeldef = undefined ) {
    if( this.options.late ) {
      this.#noack = true /* this is a MUST for late negotiation */
    } else {

      await this.#openrelatedchannel( channeldef )

      this.sdp.local = sdpgen.create()
        .addcodecs( this.options.preferedcodecs )
        .setaudioport( this.channels.audio.local.port )
        .setconnectionaddress( this.channels.audio.local.address )

      this.#checkandadd2833()

      /* DTLS is only supported ( outbound ) on websocket connections */
      if( this._iswebrtc ) {
        this.sdp.local
          .addssrc( this.channels.audio.local.ssrc )
          /* ref: https://datatracker.ietf.org/doc/html/draft-ietf-rtcweb-jsep-14#page-34 offer MUST be actpass */
          .secure( this.channels.audio.local.dtls.fingerprint ,"actpass" )
          .addicecandidates( this.channels.audio.local.address, this.channels.audio.local.port, this.channels.audio.local.icepwd )
          .rtcpmux()
      }
    }
  }

  /**
   * 
   * @param { object } callbacks 
   * @returns 
   */
  async #onnewuacsuccess( callbacks ) {

    if( this.destroyedcancelledorhungup ) {
      return this
    }

    const hangups = []
    if( this.parent ) {
      for( const child of this.parent.children ) {
        if( child !== this ) {
          child.detach()
          /* do not await - we do not want to delay the winner in 
          connecting by waiting for the completion of the hangups */
          hangups.push( child.hangup( hangupcodes.LOSE_RACE ) )
        }
      }
    }

    await Promise.all( hangups )
    callstore.set( this )

    if ( this._dialog.sip )
      this.sip.tags.remote = this._dialog.sip.remoteTag

    let cookie = undefined
    if( callbacks.prebridge )
      cookie = await callbacks.prebridge( this )

    if( true === this.#noack ) {
      await this._onlatebridge()
    } else {
      await this._onearlybridge()
    }

    if( callbacks.confirm ) await callbacks.confirm( this, cookie )

    this._em.emit( "call.answered", this )
    callmanager.options.em.emit( "call.answered", this )

    return this
  }

  /**
   * 
   * @param { object } err 
   */
  #onnewuaccatch( err ) {
    if( !this._state._hangup ) {
      if ( undefined !== err.status ) {
        let reason = hangupcodes.REQUEST_TERMINATED
        if( err.status in inboundsiperros ) reason = inboundsiperros[ err.status ]

        this.state.destroyed = true
        if( this ) this._onhangup( "wire", reason )
      } else {
        console.trace( err )
      }
    }
  }

  /**
   * https://www.ietf.org/proceedings/50/I-D/sip-privacy-01.txt
   * @returns { object }
   */
  #configcalleridfornewuac() {

    let party = ";party=calling"
    if( this.options.partycalled ) {
      party = ";party=called"
    }

    const callerid = this.callerid
    const calleridstr = `"${callerid.name}" <sip:${callerid.user}@${callerid.host}>`

    let privacy = ""
    if( true === this.options.privacy ) {
      privacy = ";privacy=full"
    }

    /*
      RFC 3325 - should we also consider the P-Preferred-Identity header?
      P-Asserted-Identity?
    */
    this.options.headers[ "remote-party-id" ] = calleridstr + party + ";screen=yes" + privacy
    this.options.headers[ "from" ] = calleridstr

    return { user: callerid.user, realm: callerid.host }
  }


  #configureto() {
    if( this.options.headers[ "to" ] ) return
    if( !this.options.entity ) return
    
    this.options.headers[ "to" ] = "<sip:" + this.options.entity.uri + ">"
  }

  /**
   * 
   * @param { string } contactstr
   */
  #configautoanswerfornewuac( contactstr ) {

    const parts = parseuri( contactstr )

    if( this.options.clicktocall ) {
      this.options.partycalled = true
      this.options.autoanswer = true
    }

    if( !this.options.contactparams ) this.options.contactparams = ""
    if( true === this.options.autoanswer ) {
      this.options.headers[ "call-info" ] = `<sip:${parts.host}>;answer-after=0`
      this.options.headers[ "alert-info" ] = "auto-answer"
      this.options.contactparams += ";intercom=true"
    } else if ( "number" == typeof this.options.autoanswer ) {
      this.options.headers[ "call-info" ] = `<sip:${parts.host}>;answer-after=${this.options.autoanswer}`
      this.options.headers[ "alert-info" ] = "auto-answer"
      this.options.contactparams += ";intercom=true"
    }
  }

  /**
   * Export headers from optioms
   * @param { object } options 
   */
  export( options ) {
    if ( options.headers ) {
      for ( const header in options.headers ) {
        this.propagate.headers[ header ] = options.headers[ header ]
      }
    }
    if ( options.autoanswer ) this.propagate.autoanswer = options.autoanswer
  } 

  /**
   * Import headers from parent call
   */
  import() {
    if ( this.parent ) {
      for ( const header in this.parent.propagate.headers ) {
        if ( !( header in this.options.headers ) ) {
          this.options.headers[ header ] = this.parent.propagate.headers[ header ]
        }
      }
      if( "autoanswer" in this.parent.propagate ) {
        this.options.autoanswer = this.parent.propagate.autoanswer
      }
    }
  }

  #confignetwork( options, ) {
    const addressparts = parseuri( options.contact )
    if( addressparts ) {
      this.network.remote.address = addressparts.host
      if( addressparts.port ) this.network.remote.port = addressparts.port
    }
  }

  /**
   * @typedef { object } calloptions
   * @property { call } [ parent ] - the parent call object
   * @property { boolean } [ orphan ] - orphan this call once made
   * @property { string } [ contact ] - The contact string
   * @property { string } [ preferedcodecs ] as it says
   * @property { boolean } [ rfc2833 ] if set to true enable 2833
   * @property { string } [ contactparams ] - additional params to add to the contact string in the invite
   * @property { object } [ auth ]
   * @property { string } [ auth.username ] - If SIP auth required username
   * @property { string } [ auth.password ] - If SIP auth required password
   * @property { object } [ headers ] - Object containing extra sip headers required.
   * @property { object } [ uactimeout ] - override the deault timeout
   * @property { true | number } [ autoanswer ] - if true add call-info to auto answer, if number delay to add
   * @property { boolean } [ clicktocall ] - if set to true, will set autoanswer to true and swap the source and desination on caller ID
   * @property { boolean } [ partycalled ] - reverses the direction of the call from the invite
   * @property { boolean } [ late ] - late negotiation
   * @property { boolean } [ privacy ] - sets the privacy
   * @property { entity } [ entity ] - used to store this call against and look up a contact string if not supplied.
   * @property { object } [ entity ]
   * @property { string } [ entity.username ]
   * @property { string } [ entity.realm ]
   * @property { string } [ entity.uri ]
   * @property { number } [ entity.max ] - if included no more than this number of calls for this entity (only if we look user up)
   * @property { number } [ entity.first ] - if multiple contacts for this entity use the first only
   * @property { object } [ callerid ]
   * @property { string } [ callerid.number ]
   * @property { string } [ callerid.name ]
   * @property { string } [ callerid.host ]
   * @property { object } [ calledid ]
   * @property { string } [ calledid.number ]
   * @property { string } [ calledid.name ]
   * @property { call  } [ bond ] - other channel to bond to for pottential channel pairing
   */

  /**
  * @callback earlycallback
  * @param { call } call - our call object which is early
  */

  /**
   * @callback confirmcallback
   * @async
   * @param { call } call - our call object which is early
   */

  /**
   * @callback failcallback
   * @param { call } call - our call object which is early
   */

  /**
   * @typedef { object } newuaccallbacks
   * @property { earlycallback } [ early ] - callback to provide a call object with early call (pre dialog)
   * @property { confirmcallback } [ confirm ] - called when a dialog is confirmed but before it is bridged with a parent - this provides an opportunity for another call to adopt this call
   * @property { failcallback } [ fail ] - Called when child is terminated
   */

  /**
   * @summary Creates a new SIP dialog(s). Returns a promise which resolves
   * when the dialog is either answered (or cancelled for some reason).
   * The promise resolves to a new call is one is generated, or undefined if not.
   * @param { calloptions } [ options ] - Options object. See default_options in index.js for more details.
   * @param { newuaccallbacks } [ callbacks ]
   * @return { Promise< call | false > } - returns a promise which resolves to a new call object if a dialog has been confirmed. If none are confirmed then return false. Each attempt is fed into callbacks.early.
   */
  // eslint-disable-next-line complexity
  static async newuac( options, callbacks = {} ) {

    if( !options.contact && !options.entity ) return false

    /* If we don't have a contact we need to look up the entity */
    if( undefined === options.contact ) {
      return await call.#callcontactfornewuac( options, callbacks )
    }

    const newcall = new call()
    newcall.type = "uac"

    if( options.parent ) {
      options.parent.adopt( newcall )
    }

    newcall.bond( options.bond )

    // spread is not recursive
    newcall.options = { ...newcall.options, ...options }
    const tmpheaders =  { ...callmanager.options.headers, ...newcall.options.headers, ...options.headers }
    newcall.options.headers = keynameslower( tmpheaders )

    if( options.entity ) {
      newcall.entity = options.entity
      callstore.set( newcall )
    }

    newcall.#configcalleridfornewuac()
    newcall.#configureto()
    newcall.import()

    newcall.#configautoanswerfornewuac( options.contact )

    newcall.options.headers[ "allow-events" ] = "talk, hold, presence, as-feature-event, dialog, call-info, sla, include-session-description, message-summary, refer"
    newcall.options.headers[ "allow" ] = "INVITE, ACK, BYE, CANCEL, OPTIONS, MESSAGE, INFO, UPDATE, REGISTER, REFER, NOTIFY, PUBLISH, SUBSCRIBE"
    newcall.options.headers[ "supported" ] = "timer, path, replaces"
    
    newcall.#confignetwork( options )
    await newcall.#openchannelsfornewuac()

    let newdialog
    try {
      newdialog = await callmanager.options.srf.createUAC( 
        options.contact + newcall.options.contactparams, 
        { 
          ...newcall.options,
          ...{ noAck: newcall.#noack },
          ...{ localSdp: newcall.sdp.local?newcall.sdp.local.toString():"" 
          } }, {

          cbRequest: ( err, req ) => {

            if( !req ) {
              newcall.state.destroyed = true
              newcall.hangup( hangupcodes.SERVER_ERROR )
              console.trace( "No req object??", err )
              return
            }

            /* set new uac timeout */
            newcall.uactimeout = newcall.options.uactimeout

            /* extend our parent ring timeout if necasary */
            if( options.parent ) {
              options.parent.uactimeout = Math.max( callmanager.options.uactimeout, newcall.options.uactimeout )
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

            newcall.parseallow( res )

            if( 180 === res.status ) {
              newcall._onring()
            } else if( 183 === res.status ) {
              await newcall._onearly()
            }

            if( newcall.canceled ) {
              newcall.hangup()
            }
          }
        } )
    } catch ( err ) {
      newcall.#onnewuaccatch( err )
    }

    if( !newdialog ) {
      if( callbacks.fail ) callbacks.fail( newcall )
      return newcall
    }

    newcall.parseallow( newdialog.res )

    newcall.#setdialog( newdialog )
    await newcall.#onnewuacsuccess( callbacks )

    return newcall
  }

  /**
   * assign our dialog and related items
   * @param { object } d 
   */
  #setdialog( d ) {
    clearTimeout( this._timers.newuac )
    this._timers.newuac = undefined

    if( this.destroyedcancelledorhungup ) return

    this._dialog = d
    this.established = true
  }

  /**
   * Take as input a request or a response.
   *
   * @param { object } req
   */
  parseallow( req ) {
    if( !req || !req.get ) return

    let allw = req.get( "Allow" )
    if( "string" === typeof allw ) {
      allw = allw.trim()
      allw = allw.replace( /"/g, "" )
      this._allow = allw.split( /[\s,]+/ )
    } else {
      const contact = req.getParsedHeader( "Contact" )
      if( !contact ) return
      if( contact[ 0 ].params && contact[ 0 ].params.methods ) {
        let methods = contact[ 0 ].params && contact[ 0 ].params.methods
        methods = methods.replace( /"/g, "" )
        this._allow = methods.split( /[\s,]+/ )
      }
    }
  }

  /**
  Create a new object when we receive an INVITE request.

  @param { object } req - req object from drachtio
  @param { object } res - res object from drachtio
  @returns { Promise< call > }
  */
  static async frominvite( req, res ) {
    const c = new call()

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
    c._req.on( "cancel", ( /*req*/ ) => c._oncanceled( /*req*/ ) )

    /**
    @member
    @private
    */
    c._res = res

    c.parseallow( req )

    await callstore.set( c )
    callmanager.options.em.emit( "call.new", c )

    if( c._req.msg && c._req.msg.body ) {
      c.sdp.remote = sdpgen.create( c._req.msg.body )
      c.sdp.remote.intersection( callmanager.options.preferedcodecs, true )
    }

    /* set a timer using the default */
    c.uactimeout = callmanager.options.uactimeout

    return c

  }

  static hangupcodes = hangupcodes
  static setcallmanager( cm ) {
    callmanager = cm
  }

  /**
   * @param { number } ms - timeout for new call
   */
  set uactimeout( ms ) {
    if( this.established ) return

    clearTimeout( this._timers.newuac )
    this._timers.newuac = setTimeout( () => {
      this.hangup( hangupcodes.REQUEST_TIMEOUT )
    }, ms )
  }
}

module.exports = call
