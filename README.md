# Astra Games (MVP)

Astra Games on 1v1 online duelliplatvormi esmane MVP-versioon. See keskkond võimaldab mängijatel harjutada oskuspõhist kivi-paber-käärid duelli mock Pi tokenitega, luua lobby’sid ning kogeda automaatset escrow loogikat enne päris Pi Network integratsiooni – nüüd kosmilise PancakeSwap × DALL·E stiilis esilehega.

## Funktsioonid

- 🔐 **Mock login** – vali kasutajanimi ja saa koheselt 1000 π saldo.
- 🥞 **PancakeSwap × DALL·E inspireeritud UI** – tumeda/hele teema lüliti, kosmiline esileht, hero illustratsioon ja andurikaarid.
- 🏠 **Lobby süsteem** – loo buy-in’iga lobby, üks mängija lobby kohta, escrow hoiab panused kuni lõpptulemuseni.
- ⚔️ **PvP duellid** – best-of-3 kivi/paber/käärid matš, AFK kaitse kontrollib 10-sekundilist taimerit.
- 🤖 **Astra AI harjutusarena** – kohaneb sinu varasemate käikude järgi ja kuvab tulemuste ajalugu.
- 👥 **Sõbrad ja soovitused** – eraldiseisev Friends vaade lisamiseks/kustutamiseks, profiil keskendub statistikatele.
- 🏆 **Elavad turniirid & kogukonna chat** – kõik turniirid on kohe aktiivsed, re-entry kasvatab poti ning top3 saab 90% jaotuse; chat hoiab fookuse ning kerib automaatselt alla.
- 📊 **Profiili ülevaade** – võidud, kaotused, netovõit, hiljutised mängud ning call-to-action sõprade haldamiseks.

Kõik andmed hoitakse mälu sees (mock Supabase). Taaskäivituse järel läheb olukord nulli.

## Struktuur

```
.
├── public/           # Statiline SPA (HTML, CSS, JS)
├── server/           # Node.js HTTP server ja mänguloogika
├── package.json
└── README.md
```

## Käivitamine

1. Veendu, et sul on paigaldatud Node.js (>=18).
2. Käivita server:

   ```bash
   npm start
   ```

3. Ava brauseris [http://localhost:3000](http://localhost:3000) ja logi sisse mock kasutajaga.

## Arhitektuuri märksõnad

- **server/store.js** hoiab kasutajad, sessioonid, lobby’d, mängud, turniirid ja chat’i mälu sees ning lahendab vooru tähtaegu.
- **server/server.js** on kerge Node.js HTTP server, mis teenindab SPA-d ja API päringuid koos küpsistepõhise sessiooniga.
- **public/app.js** on vanilla JavaScript SPA, mis haldab sessiooni, temaatikat, lobby’d, chat’i ja mänguvoogu.

## Tulevikutöö

- Supabase / Pi Network wallet’i integreerimine päris andmete jaoks.
- Reaalajas sündmused (WebSocket/SSE) lobby ja mängu uuendusteks.
- Sõbralisti, kutsete ja lobby chati realiseerimine.

