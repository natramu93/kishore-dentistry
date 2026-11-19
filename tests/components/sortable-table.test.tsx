import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Table, TableHead, TableHeader, TableBody, TableCell, TableRow } from "@/components/ui/table";

afterEach(cleanup);
it("sorts every column with currency, dates, nested labels and pinned totals", () => {
  render(<Table aria-label="Example">
    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Amount</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
    <TableBody>
      <TableRow><TableCell><a href="/a"><span>Alpha</span></a></TableCell><TableCell>₹1,000.00</TableCell><TableCell>2 Nov 2026</TableCell></TableRow>
      <TableRow><TableCell>Beta</TableCell><TableCell>₹200.00</TableCell><TableCell>30 Oct 2026</TableCell></TableRow>
      <TableRow data-sort-fixed><TableCell>Total</TableCell><TableCell>₹1,200.00</TableCell><TableCell /></TableRow>
    </TableBody>
  </Table>);
  const names = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
  fireEvent.click(screen.getByRole("button", { name: "Sort displayed rows by Amount" }));
  expect(names()).toEqual(["Beta", "Alpha", "Total"]);
  expect(screen.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "ascending");
  fireEvent.click(screen.getByRole("button", { name: "Sort displayed rows by Amount" }));
  expect(names()).toEqual(["Alpha", "Beta", "Total"]);
  fireEvent.click(screen.getByRole("button", { name: "Sort displayed rows by Date" }));
  expect(names()).toEqual(["Beta", "Alpha", "Total"]);
  fireEvent.click(screen.getByRole("button", { name: "Sort displayed rows by Name" }));
  expect(names()).toEqual(["Alpha", "Beta", "Total"]);
});

it("keeps numeric sort metadata and row controls attached to their records", () => {
  render(<Table><TableHeader><TableRow><TableHead>Label</TableHead><TableHead>Due</TableHead></TableRow></TableHeader>
    <TableBody><><TableRow><TableCell>A<input aria-label="Row A" defaultValue="A" /></TableCell><TableCell data-sort-value={20}>Due ₹20</TableCell></TableRow>
      <TableRow><TableCell>B<input aria-label="Row B" defaultValue="B" /></TableCell><TableCell data-sort-value={5}>Due ₹5</TableCell></TableRow></></TableBody>
  </Table>);
  fireEvent.change(screen.getByLabelText("Row A"), { target: { value: "changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Sort displayed rows by Due" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("B");
  expect(screen.getByLabelText("Row A")).toHaveValue("changed");
});

it("does not generate sort buttons for server-sorted tables or empty action columns", () => {
  render(<><Table sortable={false}><TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader>
    <TableBody><TableRow><TableCell>A</TableCell></TableRow></TableBody></Table>
    <Table><TableHeader><TableRow><TableHead><span className="sr-only">Actions</span></TableHead><TableHead /></TableRow></TableHeader>
      <TableBody><TableRow><TableCell>View</TableCell><TableCell /></TableRow></TableBody></Table></>);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("sorts clinic times chronologically, not as text, and discards old-page row snapshots", () => {
  const view = (rows: [string, string][]) => <Table><TableHeader><TableRow><TableHead>Time</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map(([id, time]) => <TableRow key={id}><TableCell>{time}</TableCell></TableRow>)}</TableBody></Table>;
  const { rerender } = render(view([["a", "2:30 PM"], ["b", "11:00 AM"]]));
  fireEvent.click(screen.getByRole("button", { name: "Sort displayed rows by Time" }));
  expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual(["11:00 AM", "2:30 PM"]);
  rerender(view([["c", "9:00 PM"], ["d", "12:00 AM"]]));
  expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual(["12:00 AM", "9:00 PM"]);
  fireEvent.click(screen.getByRole("button", { name: "Sort displayed rows by Time" }));
  fireEvent.click(screen.getByRole("button", { name: "Sort displayed rows by Time" }));
  rerender(view([["c", "1:00 AM"], ["d", "10:00 PM"]]));
  expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual(["1:00 AM", "10:00 PM"]);
});
