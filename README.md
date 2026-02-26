# 🚀 UPPORTUNIX Backend - Déploiement

## Stack technique
- **Runtime**: Node.js 18+
- **Framework**: Express.js 4.18
- **Base de données**: SQLite 3
- **Auth**: JWT (7 jours)
- **Email**: Nodemailer (SMTP configurable par utilisateur)
- **IA**: Anthropic Claude API

---

## ⚡ Démarrage local

```bash
# Installer les dépendances
npm install

# Configurer l'environnement
cp .env.example .env
# → Éditer .env avec vos valeurs

# Lancer en développement
npm run dev

# Lancer en production
npm start
```

API disponible sur : `http://localhost:4000`

---

## 🚀 Déploiement Railway

1. Connecter votre repo GitHub à Railway
2. Créer un nouveau service depuis le repo
3. Ajouter les variables d'environnement (depuis `.env.example`)
4. Railway détecte automatiquement Node.js et lance `npm start`

**Variables minimales à configurer sur Railway :**
```
JWT_SECRET=<générer avec: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
NODE_ENV=production
CORS_ORIGIN=https://upportunix-ia.fr
FRONTEND_URL=https://upportunix-ia.fr
API_URL=https://votre-api.railway.app
ANTHROPIC_API_KEY=sk-ant-...
ADMIN_EMAIL=admin@upportunix-ia.fr
ADMIN_PASSWORD=<mot-de-passe-fort>
```

---

## 📡 Endpoints API

### Auth
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | /api/auth/register | Créer un compte |
| POST | /api/auth/login | Se connecter |
| POST | /api/auth/forgot-password | Mot de passe oublié |
| POST | /api/auth/reset-password | Réinitialiser |

### Contacts & Listes
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /api/lists | Mes listes |
| POST | /api/lists | Créer une liste |
| GET | /api/contacts | Mes contacts (paginated) |
| POST | /api/contacts | Ajouter un contact |
| POST | /api/contacts/import | Importer CSV |
| PUT | /api/contacts/:id | Modifier |
| DELETE | /api/contacts/:id | Supprimer |

### Campagnes
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /api/campaigns | Mes campagnes |
| POST | /api/campaigns | Créer une campagne |
| GET | /api/campaigns/:id | Détails + étapes |
| PUT | /api/campaigns/:id | Modifier |
| POST | /api/campaigns/:id/launch | Lancer |
| POST | /api/campaigns/:id/pause | Mettre en pause |
| POST | /api/campaigns/:id/resume | Reprendre |
| GET | /api/campaigns/:id/stats | Statistiques |
| GET | /api/campaigns/:id/steps | Étapes |
| POST | /api/campaigns/:id/steps | Ajouter étape |
| PUT | /api/campaigns/:id/steps/:stepId | Modifier étape |
| DELETE | /api/campaigns/:id/steps/:stepId | Supprimer étape |

### Templates
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /api/templates | Mes templates |
| POST | /api/templates | Créer un template |
| PUT | /api/templates/:id | Modifier |
| DELETE | /api/templates/:id | Supprimer |

### IA (Claude)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | /api/ai/generate | Générer (subject, body, sequence, icebreaker) |
| GET | /api/ai/history | Historique générations |

### SMTP
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /api/smtp | Mes configs SMTP |
| POST | /api/smtp | Ajouter config |
| POST | /api/smtp/:id/test | Tester & envoyer email test |
| DELETE | /api/smtp/:id | Supprimer |

### Analytics
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /api/analytics/dashboard?period=30d | Dashboard global |
| GET | /api/analytics/campaigns | Stats campagnes |
| GET | /api/analytics/contacts | Stats contacts |

### Tracking (public)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /track/open/:trackingId | Pixel tracking ouvertures |
| GET | /track/click/:trackingId?url=... | Tracking clics |
| GET | /unsubscribe/:trackingId | Désabonnement |

### Admin
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /api/admin/users | Tous les utilisateurs |
| PUT | /api/admin/users/:id | Modifier utilisateur |
| GET | /api/admin/stats | Stats globales plateforme |
| GET | /api/admin/activity | Journal d'activité |

---

## 🤖 Génération IA - Exemples

### Générer des objets d'email
```bash
POST /api/ai/generate
Authorization: Bearer <token>
{
  "type": "subject",
  "context": "Logiciel de comptabilité pour PME françaises, cible: DAF, ton: professionnel",
  "language": "fr",
  "tone": "professional"
}
```

### Générer une séquence complète
```bash
POST /api/ai/generate
{
  "type": "sequence",
  "context": "Outil CRM pour agences immobilières, économise 3h/semaine sur les suivis"
}
```

---

## 📦 Variables de personnalisation emails

Dans les corps d'emails, utilisez :
- `{{prenom}}` → Prénom du contact
- `{{nom}}` → Nom du contact
- `{{entreprise}}` → Entreprise du contact
- `{{poste}}` → Titre/poste du contact

---

## 🔒 Sécurité
- Mots de passe hashés avec bcrypt (10 rounds)
- Tokens JWT avec expiration
- CORS configuré par domaines autorisés
- Validation des types de fichiers uploadés
- Foreign keys SQLite activées
