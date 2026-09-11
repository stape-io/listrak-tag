const encodeUriComponent = require('encodeUriComponent');
const getAllEventData = require('getAllEventData');
const getRequestHeader = require('getRequestHeader');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeInteger = require('makeInteger');
const makeNumber = require('makeNumber');
const makeString = require('makeString');
const makeTableMap = require('makeTableMap');
const Math = require('Math');
const Promise = require('Promise');
const sendHttpRequest = require('sendHttpRequest');
const sha256Sync = require('sha256Sync');
const templateDataStorage = require('templateDataStorage');

/*==============================================================================
==============================================================================*/

const eventData = getAllEventData();

if (shouldExitEarly(data, eventData)) return;

if (data.eventType === 'order') {
  const failed = trackOrder(eventData);
  if (!failed && data.useOptimisticScenario) {
    return data.gtmOnSuccess();
  }
} else if (data.eventType === 'contact') {
  const failed =
    data.channel === 'sms' ? upsertSmsContact(eventData) : upsertEmailContact(eventData);
  if (!failed && data.useOptimisticScenario) {
    return data.gtmOnSuccess();
  }
} else {
  return data.gtmOnSuccess();
}

/*==============================================================================
  Vendor related functions
==============================================================================*/

function trackOrder(eventData) {
  const orderData = mapOrderData(eventData);

  if (!requireValue(orderData.orderNumber, 'orderNumber', '🛑 [ERROR] Order was not sent.'))
    return true;

  performApiCall('https://api.listrak.com/data/v1/Order', 'POST', [orderData]);
  return false;
}

function mapOrderData(eventData) {
  const ORDER_NUMERIC_PROPERTIES = [
    'itemTotal',
    'shippingTotal',
    'taxTotal',
    'handlingTotal',
    'orderTotal',
    'merchandiseDiscount',
    'nonMerchandiseDiscount'
  ];
  const orderNumber = data.orderNumber || eventData.transaction_id;
  const mappedData = {};

  if (isValidValue(orderNumber)) mappedData.orderNumber = makeString(orderNumber);

  mappedData.dateEntered = data.purchaseDate
    ? makeString(data.purchaseDate)
    : convertTimestampToISO(getTimestampMillis());

  const eventDataUserData = eventData.user_data || {};
  const email =
    data.email || eventData.email || eventDataUserData.email || eventDataUserData.email_address;
  if (isValidValue(email)) mappedData.email = email;

  const customerNumber = data.customerNumber || eventData.user_id || eventData.client_id;
  if (isValidValue(customerNumber)) mappedData.customerNumber = makeString(customerNumber);

  if (data.orderProperties && data.orderProperties.length) {
    const props = makeTableMap(data.orderProperties, 'key', 'value');
    for (let key in props) {
      mappedData[key] =
        ORDER_NUMERIC_PROPERTIES.indexOf(key) !== -1
          ? makeNumber(props[key])
          : makeString(props[key]);
    }
  }

  if (mappedData.itemTotal === undefined && isValidValue(eventData.value))
    mappedData.itemTotal = makeNumber(eventData.value);
  if (mappedData.taxTotal === undefined && isValidValue(eventData.tax))
    mappedData.taxTotal = makeNumber(eventData.tax);
  if (mappedData.shippingTotal === undefined && isValidValue(eventData.shipping)) {
    mappedData.shippingTotal = makeNumber(eventData.shipping);
  }

  const items = eventData.items;
  if (getType(items) === 'array' && items.length) {
    mappedData.items = formatItems(items, mappedData.orderNumber);
  }

  return mappedData;
}

function formatItems(items, orderNumber) {
  const formattedItems = [];

  items.forEach((item) => {
    const sku = item.sku || item.item_id;
    if (!isValidValue(sku)) return;

    const formattedItem = { orderNumber: orderNumber, sku: makeString(sku) };

    const quantity = item.quantity !== undefined ? item.quantity : item.qty;
    if (quantity !== undefined) formattedItem.quantity = makeInteger(quantity);

    if (item.price !== undefined) formattedItem.price = makeNumber(item.price);

    if (isValidValue(formattedItem.quantity) && isValidValue(formattedItem.price)) {
      formattedItem.itemTotal = makeNumber(formattedItem.quantity * formattedItem.price);
    }

    formattedItems.push(formattedItem);
  });

  if (formattedItems.length !== items.length) {
    log({
      Name: 'Listrak',
      Type: 'Message',
      Message: '⚠️ [WARNING] Some order items were dropped.',
      Reason: 'Listrak requires a "sku" (or "item_id") for every item.'
    });
  }

  return formattedItems;
}

function upsertEmailContact(eventData) {
  const eventDataUserData = eventData.user_data || {};
  const email =
    data.emailAddress ||
    eventData.email ||
    eventDataUserData.email ||
    eventDataUserData.email_address;

  if (!requireValue(data.listId, 'listId', '🛑 [ERROR] Contact was not sent.')) return true;
  if (!requireValue(email, 'emailAddress', '🛑 [ERROR] Contact was not sent.')) return true;

  const contactData = {
    emailAddress: makeString(email),
    segmentationFieldValues: mapSegmentationFieldValues()
  };
  if (isValidValue(data.subscriptionState)) contactData.subscriptionState = data.subscriptionState;
  if (isValidValue(data.externalContactID)) contactData.externalContactID = data.externalContactID;

  const url =
    'https://api.listrak.com/email/v1/List/' +
    enc(data.listId) +
    '/Contact' +
    buildContactQueryString();

  performApiCall(url, 'POST', contactData);
  return false;
}

function upsertSmsContact(eventData) {
  const eventDataUserData = eventData.user_data || {};
  const phoneNumber = data.phoneNumber || eventDataUserData.phone_number || eventDataUserData.phone;

  if (!requireValue(data.shortCodeId, 'shortCodeId', '🛑 [ERROR] SMS contact was not sent.'))
    return true;
  if (!requireValue(data.phoneListId, 'phoneListId', '🛑 [ERROR] SMS contact was not sent.'))
    return true;
  if (!requireValue(phoneNumber, 'phoneNumber', '🛑 [ERROR] SMS contact was not sent.'))
    return true;

  if (data.smsAction === 'subscribe') {
    const url =
      'https://api.listrak.com/sms/v1/ShortCode/' +
      enc(data.shortCodeId) +
      '/Contact/' +
      enc(phoneNumber) +
      '/PhoneList/' +
      enc(data.phoneListId);

    performApiCall(url, 'POST', null);
    return false;
  }

  const contactData = {
    phoneNumber: makeString(phoneNumber),
    segmentationFieldValues: mapSegmentationFieldValues()
  };
  if (isValidValue(data.smsEmailAddress)) contactData.emailAddress = data.smsEmailAddress;
  if (isValidValue(data.firstName)) contactData.firstName = data.firstName;
  if (isValidValue(data.lastName)) contactData.lastName = data.lastName;
  if (isValidValue(data.birthday)) contactData.birthday = data.birthday;
  if (isValidValue(data.postalCode)) contactData.postalCode = data.postalCode;
  if (data.optedOut) contactData.optedOut = true;

  const url =
    'https://api.listrak.com/sms/v1/ShortCode/' +
    enc(data.shortCodeId) +
    '/PhoneList/' +
    enc(data.phoneListId) +
    '/Contact';

  performApiCall(url, 'POST', contactData);
  return false;
}

function mapSegmentationFieldValues() {
  if (!data.segmentationFieldValues || !data.segmentationFieldValues.length) return [];
  return data.segmentationFieldValues.map((row) => ({
    segmentationFieldId: makeInteger(row.segmentationFieldId),
    value: makeString(row.value)
  }));
}

function buildContactQueryString() {
  const params = [];
  if (isValidValue(data.updateType)) params.push('updateType=' + enc(data.updateType));
  if (data.overrideUnsubscribe) params.push('overrideUnsubscribe=true');
  if (data.subscribedByContact) params.push('subscribedByContact=true');
  if (data.sendDoubleOptIn) params.push('sendDoubleOptIn=true');
  if (isValidValue(data.newEmailAddress))
    params.push('newEmailAddress=' + enc(data.newEmailAddress));
  if (isValidValue(data.eventIds)) params.push('eventIds=' + enc(data.eventIds));
  return params.length ? '?' + params.join('&') : '';
}

function getAccessToken() {
  const cacheKey = sha256Sync('listrak_access_token_' + data.clientId + '_' + data.clientSecret);
  const cached = templateDataStorage.getItemCopy(cacheKey);
  if (cached && cached.expiresAt > getTimestampMillis()) {
    return Promise.create((resolve) => resolve(cached.accessToken));
  }

  const body =
    'grant_type=client_credentials&client_id=' +
    enc(data.clientId) +
    '&client_secret=' +
    enc(data.clientSecret);

  return sendHttpRequest(
    'https://auth.listrak.com/OAuth2/Token',
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST'
    },
    body
  )
    .then((result) => {
      const parsedBody = JSON.parse(result.body || '{}');
      if (
        result.statusCode >= 200 &&
        result.statusCode < 400 &&
        parsedBody &&
        parsedBody.access_token
      ) {
        templateDataStorage.setItemCopy(cacheKey, {
          accessToken: parsedBody.access_token,
          expiresAt: getTimestampMillis() + (makeInteger(parsedBody.expires_in || 3600) - 60) * 1000
        });
        return parsedBody.access_token;
      }

      if (!data.useOptimisticScenario) data.gtmOnFailure();
      return undefined;
    })
    .catch(() => {
      if (!data.useOptimisticScenario) data.gtmOnFailure();
      return undefined;
    });
}

function performApiCall(url, method, body) {
  getAccessToken().then((token) => {
    if (!token) return;

    const options = { headers: { Authorization: 'Bearer ' + token }, method: method };
    let requestBody;
    if (body !== null) {
      options.headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    sendHttpRequest(url, options, requestBody)
      .then((result) => {
        const parsedBody = JSON.parse(result.body || '{}');
        const success =
          result.statusCode >= 200 && result.statusCode < 400 && !(parsedBody && parsedBody.error);

        if (!data.useOptimisticScenario) {
          if (success) data.gtmOnSuccess();
          else data.gtmOnFailure();
        }
      })
      .catch(() => {
        if (!data.useOptimisticScenario) data.gtmOnFailure();
      });
  });
}

/*==============================================================================
  Helpers
==============================================================================*/

function convertTimestampToISO(timestamp) {
  const leapYear = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const nonLeapYear = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const secToMs = (s) => s * 1000;
  const minToMs = (m) => m * secToMs(60);
  const hoursToMs = (h) => h * minToMs(60);
  const daysToMs = (d) => d * hoursToMs(24);
  const padStart = (value, length) => {
    let result = makeString(value);
    while (result.length < length) {
      result = '0' + result;
    }
    return result;
  };

  const fourYearsInMs = daysToMs(365 * 4 + 1);
  let year = 1970 + Math.floor(timestamp / fourYearsInMs) * 4;
  timestamp = timestamp % fourYearsInMs;

  while (true) {
    let isLeapYear = year % 4 === 0;
    let nextTimestamp = timestamp - daysToMs(isLeapYear ? 366 : 365);
    if (nextTimestamp < 0) {
      break;
    }
    timestamp = nextTimestamp;
    year = year + 1;
  }

  const daysByMonth = year % 4 === 0 ? leapYear : nonLeapYear;

  let month = 0;
  for (let i = 0; i < daysByMonth.length; i++) {
    const msInThisMonth = daysToMs(daysByMonth[i]);
    if (timestamp >= msInThisMonth) {
      timestamp = timestamp - msInThisMonth;
    } else {
      month = i + 1;
      break;
    }
  }

  const date = Math.ceil(timestamp / daysToMs(1));
  timestamp = timestamp - daysToMs(date - 1);
  const hours = Math.floor(timestamp / hoursToMs(1));
  timestamp = timestamp - hoursToMs(hours);
  const minutes = Math.floor(timestamp / minToMs(1));
  timestamp = timestamp - minToMs(minutes);
  const sec = Math.floor(timestamp / secToMs(1));
  timestamp = timestamp - secToMs(sec);

  return (
    year +
    '-' +
    padStart(month, 2) +
    '-' +
    padStart(date, 2) +
    'T' +
    padStart(hours, 2) +
    ':' +
    padStart(minutes, 2) +
    ':' +
    padStart(sec, 2) +
    '+0000'
  );
}

function requireValue(value, paramName, failMessage) {
  if (isValidValue(value)) return true;
  log({
    Name: 'Listrak',
    Type: 'Message',
    Message: failMessage,
    Reason: 'Missing required parameter: "' + paramName + '".'
  });
  data.gtmOnFailure();
  return false;
}

function isValidValue(value) {
  const valueType = getType(value);
  if (valueType === 'null' || valueType === 'undefined' || value !== value) return false;
  return value !== '' && value !== 'undefined' && value !== 'null';
}

function isConsentGivenOrNotRequired(data, eventData) {
  if (data.adStorageConsent !== 'required') return true;
  if (eventData.consent_state) return !!eventData.consent_state.ad_storage;
  const xGaGcs = eventData['x-ga-gcs'] || '';
  return xGaGcs[2] === '1';
}

function getUrl(eventData) {
  return eventData.page_location || getRequestHeader('referer') || eventData.page_referrer;
}

function shouldExitEarly(data, eventData) {
  if (!isConsentGivenOrNotRequired(data, eventData)) {
    data.gtmOnSuccess();
    return true;
  }

  const url = getUrl(eventData);
  if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
    data.gtmOnSuccess();
    return true;
  }
  return false;
}

function enc(value) {
  if (['null', 'undefined'].indexOf(getType(value)) !== -1) value = '';
  return encodeUriComponent(makeString(value));
}

function log(rawDataToLog) {
  rawDataToLog.TraceId = getRequestHeader('trace-id');
  logToConsole(JSON.stringify(rawDataToLog));
}
