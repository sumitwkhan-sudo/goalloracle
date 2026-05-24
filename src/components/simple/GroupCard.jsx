/**
 * GroupCard
 *
 * One group (A–L) rendered as a draggable list of 4 team rows. Position
 * badges (1st/2nd/3rd/4th) update live as the user drags. A green check
 * appears once the user has made an intentional change (touched).
 */

import React from 'react';
import { DndContext, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Check } from 'lucide-react';
import FifaTooltip from './FifaTooltip';

const POSITION_META = [
  { label: '1st', className: 'pos-1' },
  { label: '2nd', className: 'pos-2' },
  { label: '3rd', className: 'pos-3' },
  { label: '4th', className: 'pos-4' },
];

function TeamRow({ team, flag, position }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: team });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };
  const meta = POSITION_META[position];
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group-row ${meta.className} ${isDragging ? 'dragging' : ''}`}
      aria-label={`Reorder ${team}`}
      {...attributes}
      {...listeners}
    >
      <span className="group-row-handle" aria-hidden="true">
        <GripVertical size={16} />
      </span>
      <span className="group-row-flag" aria-hidden="true">{flag || '🏳️'}</span>
      <span className="group-row-name">{team}</span>
      <span className={`group-row-badge ${meta.className}`}>
        {meta.label}
        {position === 2 && <FifaTooltip />}
      </span>
    </div>
  );
}

export default function GroupCard({ group, ranking, flags, touched, onReorder, onConfirm, onUnconfirm }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = ranking.indexOf(active.id);
    const toIndex = ranking.indexOf(over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorder(arrayMove(ranking, fromIndex, toIndex));
  };

  return (
    <div className={`group-card ${touched ? 'touched' : ''}`} data-group={group} id={`group-card-${group}`}>
      <div className="group-card-header">
        <span className="group-card-title">Group {group}</span>
        {touched && (
          <span className="group-card-check" aria-label="Ranked">
            <Check size={14} />
          </span>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ranking} strategy={verticalListSortingStrategy}>
          <div className="group-card-rows">
            {ranking.map((team, i) => (
              <TeamRow key={team} team={team} flag={flags[team]} position={i} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="group-card-confirm">
        {touched ? (
          <button
            type="button"
            className="group-card-confirm-btn is-confirmed"
            onClick={() => onUnconfirm && onUnconfirm(group)}
            aria-label={`Undo confirmation for Group ${group}`}
          >
            <Check size={14} /> Confirmed &mdash; tap to edit
          </button>
        ) : (
          <button
            type="button"
            className="group-card-confirm-btn"
            onClick={() => onConfirm && onConfirm(group)}
            aria-label={`Confirm ranking for Group ${group}`}
          >
            Confirm ranking
          </button>
        )}
      </div>
    </div>
  );
}
