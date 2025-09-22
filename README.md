# Pi Duel Arena (MVP)

Pi Duel Arena on 1v1 online duelliplatvormi esmane MVP-versioon. See keskkond võimaldab mängijatel harjutada oskuspõhist kivi-paber-käärid duelli mock Pi tokenitega, luua lobby’sid ning kogeda automaatset escrow loogikat enne päris Pi Network integratsiooni.

## Funktsioonid

- 🔐 **Mock login** – vali kasutajanimi ja saa koheselt 1000π saldo.
- 🏠 **Lobby süsteem** – loo buy-in’iga lobby, üks mängija lobby kohta.
- ⚔️ **PvP duellid** – kui teine mängija liitub, alustatakse best-of-3 kivi/paber/kääride matš automaatse escrow’ga.
- 🤖 **AI treeningrežiim** – harjuta koheselt AI vastasega (valib liigutusi ajaloo põhjal).
- ⏱️ **AFK kaitse** – kui vastane ei tee 10 sekundi jooksul käiku, loetakse raund sinu kasuks.
- 💰 **Escrow + tasud** – mõlemad panustavad buy-in’i, võitja saab 90% potist, 10% jääb süsteemile.
- 📊 **Statistika ja profiil** – võidud, kaotused, netovõit, hiljutised mängud.

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

- **server/store.js** hoiab mängijaid, lobby’sid ja mänge mälu sees ning realiseerib escrow + AFK loogika.
- **server/server.js** pakub lihtsaid REST API lõppe ja teenindab SPA-d.
- **public/app.js** on vanilla JavaScript SPA, mis haldab sessiooni, lobby’sid ja mänguvaadet.

## Tulevikutöö

- Supabase / Pi Network wallet’i integreerimine päris andmete jaoks.
- Reaalajas sündmused (WebSocket/SSE) lobby ja mängu uuendusteks.
- Sõbralisti, kutsete ja lobby chati realiseerimine.

