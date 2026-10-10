"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PATIENT_TITLES, PATIENT_GENDERS, genderForTitle, patientNameTitleCase,
  type PatientTitle, type PatientGender,
} from "@/lib/patient-demographics";

/** Shared by patient intake and editing; gender can always be corrected. */
export function PatientIdentityFields({
  initialName = "", initialTitle = null, initialGender = null,
}: {
  initialName?: string;
  initialTitle?: PatientTitle | null;
  initialGender?: PatientGender | null;
}) {
  const id = useId();
  const [name, setName] = useState(patientNameTitleCase(initialName));
  const [title, setTitle] = useState(initialTitle ?? "");
  const [gender, setGender] = useState(initialGender ?? genderForTitle(initialTitle) ?? "");
  return <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[8rem_minmax(0,1fr)_10rem]">
    <div className="space-y-2">
      <Label htmlFor={`${id}-title`}>Title</Label>
      <select id={`${id}-title`} name="title" value={title}
        className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        onChange={(event) => {
          const next = event.target.value as PatientTitle | "";
          setTitle(next);
          setGender(genderForTitle(next) ?? "");
        }}>
        <option value="">Not specified</option>
        {PATIENT_TITLES.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-name`}>Name *</Label>
      <Input id={`${id}-name`} name="name" autoComplete="name" autoCapitalize="words"
        maxLength={200} required value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => setName(patientNameTitleCase(name))} />
    </div>
    <div className="space-y-2">
      <Label htmlFor={`${id}-gender`}>Gender</Label>
      <select id={`${id}-gender`} name="gender" value={gender}
        aria-describedby={`${id}-gender-help`}
        className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        onChange={(event) => setGender(event.target.value as PatientGender | "")}>
        <option value="">Not specified</option>
        {PATIENT_GENDERS.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
      </select>
      <p id={`${id}-gender-help`} className="text-xs text-muted-foreground">Suggested from title; you can change it. Choose gender for Baby.</p>
    </div>
  </div>;
}
