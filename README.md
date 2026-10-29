# Banii Mei

Aplicație web (PWA) pentru finanțe personale: import de extrase maib (CSV / Excel), evidența banilor cash, statistici și sugestii de economisire.

**Toate datele rămân pe dispozitivul tău** (IndexedDB în browser). Aplicația nu are server, nu are cont și nu trimite nimic nicăieri. Acest repository conține doar codul.

## Instalare pe Android

1. Deschide pagina aplicației în Chrome.
2. Meniul ⋮ → **Adaugă pe ecranul de pornire** / **Instalează aplicația**.
3. În aplicație: Setări → **Activează notificările**, pentru memento-ul despre cash.

## Rulare locală pe PC

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Apoi deschide http://localhost:8080.
