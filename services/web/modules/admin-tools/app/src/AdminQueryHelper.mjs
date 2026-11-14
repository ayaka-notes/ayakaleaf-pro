import _ from 'lodash'

// How the panel's lists ask Mongo: filter, sort and page in the database, with
// the counts the header filters show.

export const PAGE_SIZES = [10, 20, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 10
// names sort as people read them, whatever their case
const COLLATION = { locale: 'en', strength: 2 }

export function isObjectId(value) {
  return typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)
}

// ---- reading the query ----

export function parsePaging(query) {
  const pageSize = parseInt(query.pageSize, 10)
  return {
    page: Math.max(parseInt(query.page, 10) || 1, 1),
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    search: typeof query.search === 'string' ? query.search.trim() : '',
  }
}

export function parseOrder(query, defaultOrder) {
  return ['asc', 'desc'].includes(query.order) ? query.order : defaultOrder
}

// ---- searching ----

// a literal search: what the admin types is no regular expression
export function containing(term) {
  return { $regex: _.escapeRegExp(term), $options: 'i' }
}

function computedValueContains(input, term) {
  return {
    $expr: {
      $regexMatch: { input, regex: _.escapeRegExp(term), options: 'i' },
    },
  }
}

export function idMatches(path, term) {
  return computedValueContains({ $toString: `$${path}` }, term)
}

// A user by any of its emails, by either name, or by the "First Last" the lists
// show. For the documents of deleted users, prefix is 'user.'
export function nameOrEmailMatches(term, prefix = '') {
  const regex = containing(term)
  const fullName = {
    $concat: [
      { $ifNull: [`$${prefix}first_name`, ''] },
      ' ',
      { $ifNull: [`$${prefix}last_name`, ''] },
    ],
  }
  return [
    { [`${prefix}email`]: regex },
    { [`${prefix}emails.email`]: regex },
    { [`${prefix}first_name`]: regex },
    { [`${prefix}last_name`]: regex },
    computedValueContains(fullName, term),
  ]
}

// The emails besides the primary one that a search matches, as containing()
// does, so a row found by one of them can show it
export function matchedSecondaryEmails(user, term) {
  if (!term) return []
  const regex = new RegExp(_.escapeRegExp(term), 'i')
  return (user.emails ?? [])
    .filter(({ email }) => email !== user.email && regex.test(email))
    .map(({ email, confirmedAt }) => ({
      email,
      confirmed: Boolean(confirmedAt),
    }))
}

// ---- paging ----

// a page past the end, as after deleting its last rows, shows the last one
export function clampPage(page, total, pageSize) {
  return Math.min(page, Math.max(Math.ceil(total / pageSize), 1))
}

// the keys in the order asked for; the id keeps equal rows on the same page
export function sortBy(keys, order) {
  const direction = order === 'asc' ? 1 : -1
  return {
    ...Object.fromEntries(keys.map(key => [key, direction])),
    _id: direction,
  }
}

async function locatePage(Model, match, { page, pageSize }) {
  const total = await Model.countDocuments(match)
  const clamped = clampPage(page, total, pageSize)
  return { total, page: clamped, skip: (clamped - 1) * pageSize }
}

export async function findPage(Model, match, fields, sort, query) {
  const { total, page, skip } = await locatePage(Model, match, query)
  const rows = await Model.find(match, fields)
    .sort(sort)
    .collation(COLLATION)
    .skip(skip)
    .limit(query.pageSize)
    .lean()
    .exec()
  return { total, page, rows }
}

// findPage for the documents of deleted users and projects, reshaped by $project
export async function aggregatePage(Model, match, projection, sort, query) {
  const { total, page, skip } = await locatePage(Model, match, query)
  const rows = await Model.aggregate([
    { $match: match },
    { $sort: sort },
    { $skip: skip },
    { $limit: query.pageSize },
    { $project: projection },
  ]).collation(COLLATION)
  return { total, page, rows }
}

// ---- counting ----

function countFrom(facet) {
  return facet?.[0]?.n ?? 0
}

// How many documents match, in all and for each option ({ key: filter })
export async function countOptions(Model, match, options) {
  const keys = Object.keys(options)
  const [facets] = await Model.aggregate([
    { $match: match },
    {
      $facet: {
        all: [{ $count: 'n' }],
        // facet names cannot hold the dots a provider id may have
        ...Object.fromEntries(
          keys.map((key, i) => [
            `option${i}`,
            [{ $match: options[key] }, { $count: 'n' }],
          ])
        ),
      },
    },
  ])
  return {
    all: countFrom(facets.all),
    ...Object.fromEntries(
      keys.map((key, i) => [key, countFrom(facets[`option${i}`])])
    ),
  }
}
