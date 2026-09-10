import { Badge, Button, Card, Icon, Money, Progress } from "./ui";
import { formatDate, percent } from "../lib/format.js";

// Renders the per-goal achievement-date projection in human terms. It carries
// an icon alongside its colour, because "on track" vs "no surplus" is a state
// a red-green colourblind reader has to be able to read too.
export function Projection({ projection }) {
  if (!projection) return null;
  switch (projection.status) {
    case "achieved":
      return (
        <Badge tone="positive" icon="check">
          Goal reached
        </Badge>
      );
    case "on_track":
      return (
        <span className="row" style={{ gap: "var(--s-1)" }}>
          <Icon name="target" size={13} className="u-pos" />
          <span>
            Projected {formatDate(projection.projected_date)} · ~
            {projection.months_to_goal} mo
          </span>
        </span>
      );
    case "no_surplus":
      return (
        <span className="row u-warn" style={{ gap: "var(--s-1)" }}>
          <Icon name="alert" size={13} />
          <span>No monthly surplus to allocate</span>
        </span>
      );
    default: // no_data
      return <span className="u-muted">Add income &amp; expenses to project a date</span>;
  }
}

export default function GoalCard({ goal, accounts, onEdit, onDelete }) {
  const funders = goal.linked_account_ids
    .map((id) => accounts.find((a) => a.id === id)?.name)
    .filter(Boolean);
  const remaining = Math.max(0, goal.target_amount - goal.current_amount);
  const complete = goal.progress_pct >= 100;

  return (
    <Card className="goal-card">
      <div className="goal-top">
        <div style={{ minWidth: 0 }}>
          <div className="goal-name">{goal.name}</div>
          <div className="goal-amounts">
            <span className="goal-current">
              <Money value={goal.current_amount} tabular={false} />
            </span>
            <span className="goal-target">
              of <Money value={goal.target_amount} />
            </span>
          </div>
        </div>
        {(onEdit || onDelete) && (
          <div className="card-actions">
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                icon="pencil"
                onClick={() => onEdit(goal)}
                aria-label={`Edit ${goal.name}`}
              />
            )}
            {onDelete && (
              <Button
                variant="danger"
                size="sm"
                icon="trash"
                onClick={() => onDelete(goal)}
                aria-label={`Delete ${goal.name}`}
              />
            )}
          </div>
        )}
      </div>

      <div className="stack--tight" style={{ display: "flex", flexDirection: "column" }}>
        <Progress
          value={goal.progress_pct}
          max={100}
          size="lg"
          label={`${goal.name} progress`}
        />
        <div className="goal-progress-row">
          <span className="u-num">{percent(goal.progress_pct)} funded</span>
          <span className="u-num">
            {complete ? (
              "Fully funded"
            ) : (
              <>
                <Money value={remaining} /> to go
              </>
            )}
          </span>
        </div>
      </div>

      <div className="goal-foot">
        <span className="goal-funding" title={funders.join(", ")}>
          {funders.length > 0
            ? `Funded by ${funders.join(", ")}`
            : "No accounts linked — edit to select some"}
        </span>
        <Projection projection={goal.projection} />
      </div>

      {goal.target_date && (
        <span className="u-sm u-muted">Target date {formatDate(goal.target_date)}</span>
      )}
    </Card>
  );
}
