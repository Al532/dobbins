# Publication du site

GitHub Actions vérifie les modifications de `main` et les pull requests vers
`main`. Après validation, seuls les envois sur `main` (ou un lancement manuel
depuis `main`) sont publiés sur GitHub Pages. Une branche `test` n'est jamais
publiée automatiquement.

## Sources du texte

- Français : modifier directement `texte.html`.
- Anglais : modifier directement `texte-en.html`.
Ces deux fichiers sont les sources de référence. L’ancienne source
`texte.md` a été supprimée pour éviter toute divergence. Aucune conversion
Markdown ne doit écraser le HTML pendant le déploiement.

Les deux fichiers HTML sont publiés sans transformation. Les Markdown et
les fichiers de maintenance ne sont pas inclus dans le site publié.

## Vérifications

Le workflow vérifie la syntaxe des fichiers JavaScript et la présence des
fichiers référencés par les attributs `href`, `src` et `poster` des HTML,
ainsi que les fichiers indispensables au lecteur. Les paramètres audio
(`?start=...`) et les noms de fichiers encodés sont pris en charge.
Il ne vérifie pas les liens externes, les ancres, ni le comportement dans
le navigateur ou toutes les références générées dynamiquement.

Lancer le contrôle des fichiers avec `python3 scripts/check-site.py`.
