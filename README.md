# Cielo Romagna

Meteo della Romagna in una pagina: allerte ufficiali per zona, radar con le temperature delle località,
livelli dei fiumi da monte a valle e previsioni con il confronto tra quattro modelli.

Progetto personale e non commerciale. **Non è un servizio ufficiale**: per allerte e decisioni fa fede
[Allerta Meteo Emilia-Romagna](https://allertameteo.regione.emilia-romagna.it/).

## Come funziona

- `index.html` chiede previsioni (Open-Meteo), radar (RainViewer) e mappa (Esri) direttamente dal browser.
- Il server di Allerta Meteo ER non permette la lettura dal browser (CORS), quindi
  `.github/workflows/pubblica.yml` ogni 15 minuti esegue `scripts/dati.mjs`, che scrive `dati.json`
  (allerte di oggi e domani per le zone A1, A2, B1, B2, C2, D1 e livelli di 43 idrometri)
  e ripubblica il sito su GitHub Pages. Se ARPAE non risponde riusa l'ultimo `dati.json` pubblicato;
  se i livelli restano fermi più di due ore la Action fallisce e GitHub manda una mail.
- `.github/workflows/keepalive.yml` fa un commit al mese per non far sospendere le schedule.
- Leaflet 1.9.4 è in `assets/leaflet/` e il carattere Fraunces in `assets/fonts/` (SIL Open Font License,
  testo in `OFL.txt`): niente CDN né Google Fonts.
- Logo in `assets/logo/`: `icon.svg` (favicon e barra), `icon-quadrata.svg` e i PNG per iPhone e Android,
  `logo-orizzontale(-scuro).svg` con il testo in Fraunces già convertito in tracciati, `og.png` per l'anteprima
  dei link su WhatsApp e social.
- Tema scuro o chiaro secondo il dispositivo; il cielo in testata segue ora e tempo della località scelta.
- Lo schema dei fiumi mette ogni stazione in altezza secondo la distanza dalla costa
  (retta Cattolica–Casal Borsetti), con le coordinate che arrivano da ARPAE in `dati.json`.

## Fonti e licenze

- Allerte e livelli idrometrici: Allerta Meteo Emilia-Romagna (ARPAE e Agenzia regionale per la sicurezza
  territoriale e la protezione civile), CC BY-NC-SA 4.0.
- Previsioni: Open-Meteo.com, CC BY 4.0, piano gratuito per uso non commerciale.
- Radar: RainViewer. Mappa: Esri, OpenStreetMap.

I contenuti rielaborati del sito sono distribuiti con licenza
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.it).
Niente pubblicità né usi commerciali: lo richiedono le licenze dei dati.
