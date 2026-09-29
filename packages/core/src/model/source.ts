/**
 * The fields of an atom row the compiler reads. Prisma `Atom` rows, demo rows
 * and template fixtures all satisfy this structurally, so core never depends
 * on @prisma/client.
 */
export type SourceAtom = {
  id: string;
  type: string;
  title: string;
  content: string;
  metadata: unknown;
  createdAt?: Date;
};

/** The fields of an edge row the compiler reads. */
export type SourceEdge = {
  id: string;
  sourceAtomId: string;
  targetAtomId: string;
  label: string;
  /** Edge metadata; ASSIGNED_TO carries its role here. */
  metadata?: unknown;
  createdAt?: Date;
};
