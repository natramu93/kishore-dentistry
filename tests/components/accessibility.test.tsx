import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import axe, { type AxeResults } from "axe-core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { StatusStepper } from "@/components/leads/status-stepper";
import { PaginationNav } from "@/components/pagination-nav";

afterEach(cleanup);

async function expectNoSemanticViolations(
  container: HTMLElement
): Promise<void> {
  const results: AxeResults = await axe.run(container, {
    // jsdom has no layout/paint engine; contrast is covered by design-token
    // review and must not be reported as a semantic component result here.
    rules: {
      "color-contrast": { enabled: false },
    },
  });
  expect(
    results.violations,
    results.violations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join("\n")
  ).toEqual([]);
}

describe("accessible UI primitives", () => {
  it("associates labels, descriptions, errors, and submit controls", async () => {
    const { container } = render(
      <form aria-label="Patient contact form">
        <Label htmlFor="patient-mobile">Mobile number</Label>
        <Input
          id="patient-mobile"
          name="mobile"
          type="tel"
          required
          aria-describedby="mobile-help mobile-error"
          aria-invalid="true"
        />
        <p id="mobile-help">Include the country or area code.</p>
        <p id="mobile-error" role="alert">
          Enter a valid mobile number.
        </p>

        <Label htmlFor="patient-notes">Clinical notes</Label>
        <Textarea id="patient-notes" name="notes" />

        <Button type="submit">Save patient</Button>
        <Button type="button" size="icon" aria-label="Close editor">
          <span aria-hidden="true">×</span>
        </Button>
      </form>
    );

    expect(screen.getByLabelText("Mobile number")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(screen.getByLabelText("Clinical notes")).toHaveAccessibleName(
      "Clinical notes"
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid mobile number"
    );
    expect(
      screen.getByRole("button", { name: "Save patient" })
    ).toHaveAttribute("type", "submit");
    expect(
      screen.getByRole("button", { name: "Close editor" })
    ).toHaveAttribute("type", "button");
    await expectNoSemanticViolations(container);
  });

  it("makes horizontally scrollable tables keyboard reachable and named", async () => {
    const { container } = render(
      <Table aria-label="Upcoming patient appointments">
        <TableCaption>Appointments scheduled for the selected clinic day.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Patient</TableHead>
            <TableHead scope="col">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Kavya Raman</TableCell>
            <TableCell>10:30 AM</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    expect(
      screen.getByRole("region", { name: "Upcoming patient appointments" })
    ).toHaveAttribute("tabindex", "0");
    expect(
      screen.getByRole("table", { name: "Upcoming patient appointments" })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getByText("Appointments scheduled for the selected clinic day."))
      .toBeInTheDocument();
    await expectNoSemanticViolations(container);
  });

  it("exposes tabs, selection, and their labelled panels", async () => {
    const { container } = render(
      <Tabs defaultValue="overview">
        <TabsList aria-label="Lead details">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Patient overview content</TabsContent>
        <TabsContent value="history">Patient history content</TabsContent>
      </Tabs>
    );

    const overview = screen.getByRole("tab", { name: "Overview" });
    const history = screen.getByRole("tab", { name: "History" });
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "Overview" })
    ).toHaveTextContent("Patient overview content");

    fireEvent.click(history);
    expect(history).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tabpanel", { name: "History" })
    ).toHaveTextContent("Patient history content");
    await expectNoSemanticViolations(container);
  });
});

describe("lead progress semantics", () => {
  it("announces exactly one current pipeline stage and completed stages", async () => {
    const { container } = render(
      <StatusStepper status="appointment_booked" />
    );

    expect(screen.getByRole("list", { name: "Lead progress" })).toHaveAttribute(
      "tabindex",
      "0"
    );
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Appointment Booked, current stage");
    const stages = screen.getAllByRole("listitem");
    expect(stages[0]).toHaveTextContent("Open, completed");
    expect(stages[1]).toHaveTextContent("Assigned, completed");
    await expectNoSemanticViolations(container);
  });

  it("announces terminal missed/dropped states without marking a pipeline stage current", async () => {
    const { container, rerender } = render(
      <StatusStepper status="dropped" />
    );

    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent(
      "Dropped, current stage"
    );

    rerender(<StatusStepper status="missed" />);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent(
      "Missed, current stage"
    );
    await expectNoSemanticViolations(container);
  });
});

describe("pagination semantics", () => {
  it("preserves filters, exposes result position, and names navigation", async () => {
    const { container } = render(
      <PaginationNav
        pathname="/appointments"
        searchParams={{
          view: "week",
          status: "scheduled",
          page: "2",
        }}
        page={2}
        pageSize={25}
        total={61}
      />
    );

    expect(screen.getByRole("navigation", { name: "Results pages" }))
      .toBeInTheDocument();
    expect(screen.getByText("Showing 26–50 of 61")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/appointments?view=week&status=scheduled"
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/appointments?view=week&status=scheduled&page=3"
    );
    await expectNoSemanticViolations(container);
  });

  it("renders unavailable directions as disabled buttons, not active links", () => {
    render(
      <PaginationNav
        pathname="/leads"
        searchParams={{}}
        page={1}
        pageSize={25}
        total={10}
      />
    );

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });
});
