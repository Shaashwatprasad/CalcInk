import type { EquationProjection } from './index';

export interface CalculationRecord {
  id: string;
  expression: string;
  answer: string;
  sequence: number;
}

/** One completed record per equation. Results are derived from the current notebook. */
export class CalculationHistory {
  private documentId = '';
  private sequence = 0;
  private records = new Map<string, CalculationRecord>();
  private versions = new Map<string, EquationProjection>();
  private activeId?: string;

  update(documentId: string, projections: readonly EquationProjection[]) {
    if (this.documentId !== documentId) {
      this.documentId = documentId;
      this.records.clear();
      this.versions.clear();
      this.activeId = undefined;
      this.sequence = 0;
    }
    const ids = new Set(projections.map((p) => p.equationId));
    for (const id of this.records.keys())
      if (!ids.has(id)) this.records.delete(id);
    for (const id of this.versions.keys())
      if (!ids.has(id)) this.versions.delete(id);
    for (const projection of projections) {
      const previous = this.versions.get(projection.equationId);
      if (previous === projection) continue;
      this.versions.set(projection.equationId, projection);
      if (
        !previous ||
        previous.equationRevision !== projection.equationRevision ||
        previous.expression !== projection.expression
      )
        this.activeId = projection.equationId;
      if (
        projection.status === 'valid' ||
        projection.status === 'variable-defined' ||
        projection.status === 'undefined'
      ) {
        const answer =
          projection.answerText ??
          (projection.outcome?.status === 'variable-defined'
            ? projection.outcome.display
            : '');
        const record = this.records.get(projection.equationId);
        if (
          !record ||
          record.expression !== projection.expression ||
          record.answer !== answer
        )
          this.records.set(projection.equationId, {
            id: projection.equationId,
            expression: projection.expression,
            answer,
            sequence: ++this.sequence,
          });
      } else this.records.delete(projection.equationId);
    }
    if (!this.activeId || !ids.has(this.activeId))
      this.activeId = projections.at(-1)?.equationId;
    return {
      current: projections.find((p) => p.equationId === this.activeId),
      records: [...this.records.values()].sort(
        (a, b) => b.sequence - a.sequence,
      ),
    };
  }
}
