# Minichat Gender Probe

Diagnostic Frida probe for the analyzed iOS Minichat build.

## Target

- Bundle ID: `com.minichat`
- App version observed during analysis: `5.379`
- Build observed during analysis: `6.0`

## Purpose

The probe observes the client-side requested gender and the gender returned in the match result.

It monitors:

- `VideoChatInteractor -updateServerSex:`
- `VideoChatInteractor -sendTextToServer:`
- `_TtC8Minichat11BeginDialog -initWithJson:`
- `VideoChatInteractor -messagingSRServiceWebSocketDidReceiveMessage:`

It does **not** modify method arguments, return values, account state, entitlements, or server responses.

## Known mapping

From static analysis of the supplied IPA:

- `0` = Any
- `1` = Male
- `2` = Female

Observed outbound flow:

```text
UED{"Gender":2}
NXT{}
```

The server-returned match gender is read from `BeginDialog.gender`.

## Run

With the device reachable by Frida:

```bash
frida -U -f com.minichat -l minichat_gender_probe.js
```

If Minichat is already running:

```bash
frida -U -n Minichat -l minichat_gender_probe.js
```

## Expected output

Successful requested/returned match:

```text
[GenderProbe] Requested = Female (2)
[GenderProbe] OUT UED{"Gender":2}
[GenderProbe] OUT NXT{}
[GenderProbe] MATCH | Requested: Female (2) | Matched: Female (2) | PairId: ...
```

A different returned gender:

```text
[GenderProbe] DIFFERENT | Requested: Female (2) | Matched: Male (1) | PairId: ...
```

## Interpretation

`MATCH` means the `BeginDialog.gender` returned by the application flow equals the requested `serverType`.

`DIFFERENT` means the returned match gender differs from what the client requested.

This is an observation tool only. A mismatch does not by itself establish why the service returned that result.
