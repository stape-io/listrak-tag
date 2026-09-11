# Listrak tag for Google Tag Manager Server Side

The **Listrak tag for the Google Tag Manager server container** allows you to integrate your website with Listrak by sending Order data to Listrak's Data API and creating or updating Contacts via Listrak's Email or SMS API.

This server-to-server integration helps improve data accuracy and security by communicating directly with Listrak from your server, bypassing client-side tracking limitations.

## Features

The tag supports two event types:

- Order (sent to Listrak's Data API)
- Contact create/update, on either channel:
  - Email (sent to Listrak's Email API)
  - SMS (sent to Listrak's SMS API, with a **Create Contact** or **Subscribe Contact** action)

## How to use

1.  Add the **Listrak Conversions API** tag to your GTM Server container from the Template Gallery.
2.  Create a new tag and select the **Event Type** you want to send (**Order** or **Contact**).
3.  Provide your Listrak **Client ID** and **Client Secret** from a Listrak Integration (Account Settings > Integrations > Integration Management) — a "Data" integration for Order events, an "Email" or "SMS" integration for Contact events depending on the Channel chosen. See [Locating the Client Secret and ID](https://help.listrak.com/en/articles/1465526-locating-the-client-secret-and-id) if you need help finding them. The tag authenticates via OAuth2 client credentials and caches the access token automatically.
4.  Map the required fields depending on the event type:
    - **Order**: **Order Number** and optional Order Properties (item/shipping/tax totals, discounts, coupon code, tracking, etc.).
    - **Contact** (**Email** channel): **List ID** and **Email Address**, plus optional Profile Fields and Advanced Options (Update Type, Subscription settings, Event IDs).
    - **Contact** (**SMS** channel): **Short Code ID**, **SMS List ID** and **Phone Number**. Choose **Create Contact** to create/update the contact (optionally with Email Address, First/Last Name, Birthday, Postal Code, Opted Out and Profile Fields) or **Subscribe Contact** to subscribe a contact that already exists on the Short Code.

## Open Source

The **Listrak tag for GTM Server Side** is developed and maintained by [Stape Team](https://stape.io/) under the Apache 2.0 license.
