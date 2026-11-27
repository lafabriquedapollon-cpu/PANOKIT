# J06-A — Contrat de devis isolé (LAB, non commercial)

GOAL: démontrer le calcul serveur d'un montant indicatif de test et son refus fermé.
Aucun endpoint, enregistrement AppModule, connexion DB, données réelles, commande ou paiement.
Le bouton Studio reste désactivé. Le code n'est pas un moteur LIVE.

- Entrée non fiable: modèle pilote, identifiant format, révision industrielle, révision tarif attendue (null seulement pour première consultation), identifiants options, retrait/dépôt ou référence destination synthétique. Toute propriété étrangère est refusée.
- Port serveur: une lecture cohérente des données industrielles et approbation J03, version tarif LAB et approbation séparée liée à son digest, résolution destination/dépôt/zone. Le port n'est pas implémenté et ne doit jamais être construit à partir d'un JSON client.
- Prix: MAD, unités mineures entières, BigInt intermédiaire, bornes Number.MAX_SAFE_INTEGER, taux en points de base configuré, un taux commun et arrondi demi-supérieur une seule fois sur le total HT (hypothèse LAB, aucune règle fiscale réelle certifiée). Retrait gratuit dans ce LAB. Aucun prix ni TVA réels.
- Livraison: zones et dépôts multiples, résolution par serveur ; hors couverture = refus, aucun montant partiel. Calcul kilométrique, attribution réelle du dépôt et adresse validée différés.
- Sortie: LAB, orderable=false, montants HT/TVA/TTC, versions et empreinte canonique de cohérence; aucun élément privé J03. Empreinte non signée, pas de preuve d'autorité ni token d'achat.
- Limitations: aucune transaction DB, persistance immuable, horloge/expiration, validation du visuel, signature, idempotence ou autorisation de commande. Toute future acceptation devra relire les versions, résoudre l'adresse de façon fiable et recalculer côté serveur. L'approbation LAB ne doit pas être traduite en autorisation LIVE.
- Prochaine tranche: preuve HTTP locale isolée, choix définitif de règles fiscales et modèle tarif versionné, maquettes DEV-01 FR/AR desktop/mobile avant toute UI. SEC-01 et homologation restent gates LIVE.

SUCCESS: tests unitaires exécutés et CI complète au SHA exact, zéro modification du frontend, AppModule, dépendances ou workflows.
