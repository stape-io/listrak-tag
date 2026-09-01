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
  const failed = upsertContact(eventData);
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

  if (!isValidValue(orderData.orderNumber)) {
    log({
      Name: 'Listrak',
      Type: 'Message',
      Message: '🛑 [ERROR] Order was not sent.',
      Reason: 'Missing required parameter: "orderNumber".'
    });
    data.gtmOnFailure();
    return true;
  }

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
  if (isValidValue(data.email)) mappedData.email = data.email;
  else if (eventData.email) mappedData.email = eventData.email;
  else if (eventDataUserData.email) mappedData.email = eventDataUserData.email;
  else if (eventDataUserData.email_address) mappedData.email = eventDataUserData.email_address;

  if (isValidValue(data.customerNumber))
    mappedData.customerNumber = makeString(data.customerNumber);
  else if (eventData.user_id) mappedData.customerNumber = makeString(eventData.user_id);
  else if (eventData.client_id) mappedData.customerNumber = makeString(eventData.client_id);

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

function upsertContact(eventData) {
  const eventDataUserData = eventData.user_data || {};
  const email =
    data.emailAddress ||
    eventData.email ||
    eventDataUserData.email ||
    eventDataUserData.email_address;

  if (!isValidValue(data.listId)) {
    log({
      Name: 'Listrak',
      Type: 'Message',
      Message: '🛑 [ERROR] Contact was not sent.',
      Reason: 'Missing required parameter: "listId".'
    });
    data.gtmOnFailure();
    return true;
  }

  if (!isValidValue(email)) {
    log({
      Name: 'Listrak',
      Type: 'Message',
      Message: '🛑 [ERROR] Contact was not sent.',
      Reason: 'Missing required parameter: "emailAddress".'
    });
    data.gtmOnFailure();
    return true;
  }

  const contactData = {
    emailAddress: makeString(email),
    segmentationFieldValues: mapSegmentationFieldValues()
  };
  if (isValidValue(data.subscriptionState)) contactData.subscriptionState = data.subscriptionState;
  if (isValidValue(data.externalContactID)) contactData.externalContactID = data.externalContactID;

  const url =
    'https://api.listrak.com/email/v1/List/' +
    encodeUriComponent(data.listId) +
    '/Contact' +
    buildContactQueryString();

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
  if (isValidValue(data.updateType))
    params.push('updateType=' + encodeUriComponent(data.updateType));
  if (data.overrideUnsubscribe) params.push('overrideUnsubscribe=true');
  if (data.subscribedByContact) params.push('subscribedByContact=true');
  if (data.sendDoubleOptIn) params.push('sendDoubleOptIn=true');
  if (isValidValue(data.newEmailAddress)) {
    params.push('newEmailAddress=' + encodeUriComponent(data.newEmailAddress));
  }
  if (isValidValue(data.eventIds)) params.push('eventIds=' + encodeUriComponent(data.eventIds));
  return params.length ? '?' + params.join('&') : '';
}

function getAccessToken() {
  const cacheKey = 'listrak_access_token:' + data.clientId;
  const cached = templateDataStorage.getItemCopy(cacheKey);
  if (cached && cached.expiresAt > getTimestampMillis()) {
    return Promise.create((resolve) => resolve(cached.accessToken));
  }

  const body =
    'grant_type=client_credentials&client_id=' +
    encodeUriComponent(data.clientId) +
    '&client_secret=' +
    encodeUriComponent(data.clientSecret);

  return sendHttpRequest(
    'https://auth.listrak.com/OAuth2/Token',
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      timeout: 3500
    },
    body
  ).then((result) => {
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

    logApiError('🛑 [ERROR] Failed to obtain a Listrak access token.', result.statusCode, parsedBody);
    return Promise.create((resolve, reject) => reject({ reason: 'auth_failed' }));
  });
}

function performApiCall(url, method, body) {
  getAccessToken()
    .then((token) =>
      sendHttpRequest(
        url,
        {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          method: method,
          timeout: 3500
        },
        JSON.stringify(body)
      )
    )
    .then((result) => {
      const parsedBody = JSON.parse(result.body || '{}');
      const success =
        result.statusCode >= 200 && result.statusCode < 400 && !(parsedBody && parsedBody.error);

      if (!success) {
        logApiError('🛑 [ERROR] Listrak API call failed.', result.statusCode, parsedBody);
      }

      if (!data.useOptimisticScenario) {
        if (success) data.gtmOnSuccess();
        else data.gtmOnFailure();
      }
    })
    .catch((error) => {
      logApiError(
        '🛑 [ERROR] Listrak API request failed.',
        (error && error.reason) || 'unknown_error',
        {}
      );
      if (!data.useOptimisticScenario) data.gtmOnFailure();
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

function isValidValue(value) {
  const valueType = getType(value);
  return valueType !== 'null' && valueType !== 'undefined' && value !== '' && value === value;
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

function logApiError(message, status, response) {
  log({
    Name: 'Listrak',
    Type: 'Message',
    Message: message,
    Status: status,
    Response: response
  });
}

function log(rawDataToLog) {
  rawDataToLog.TraceId = getRequestHeader('trace-id');
  logToConsole(JSON.stringify(rawDataToLog));
}
