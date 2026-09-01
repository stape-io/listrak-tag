# Listrak tag for Google Tag Manager Server Side

The **Listrak tag for the Google Tag Manager server container** allows you to integrate your website with Listrak by sending Order data to Listrak's Data API and creating or updating Contacts via Listrak's Email API.

This server-to-server integration helps improve data accuracy and security by communicating directly with Listrak from your server, bypassing client-side tracking limitations.

## Features

The tag supports two event types:

- Order (sent to Listrak's Data API)
- Contact create/update (sent to Listrak's Email API)

## How to use

1.  Add the **Listrak Conversions API** tag to your GTM Server container from the Template Gallery.
2.  Create a new tag and select the **Event Type** you want to send (**Order** or **Contact**).
3.  Provide your Listrak **Client ID** and **Client Secret** from a Listrak Integration (Account Settings > Integrations > Integration Management) — a "Data" integration for Order events, an "Email" integration for Contact events. The tag authenticates via OAuth2 client credentials and caches the access token automatically.
4.  Map the required fields depending on the event type: **Order Number** and optional Order Properties (item/shipping/tax totals, discounts, coupon code, tracking, etc.) for Order events; **List ID** and **Email Address** for Contact events, plus optional Profile Fields and Advanced Options (Update Type, Subscription settings, Event IDs).

## Open Source

The **Listrak tag for GTM Server Side** is developed and maintained by [Stape Team](https://stape.io/) under the Apache 2.0 license.
