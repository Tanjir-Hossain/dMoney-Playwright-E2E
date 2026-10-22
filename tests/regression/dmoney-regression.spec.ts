import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { SignupPage } from '../../pages/SignupPage';
import { LoginPage } from '../../pages/LoginPage';
import { AdminPage } from '../../pages/AdminPage';
import { SystemPage } from '../../pages/SystemPage';
import { AgentPage } from '../../pages/AgentPage';
import { PasswordResetPage } from '../../pages/PasswordResetPage';
import { GmailClient } from '../../utils/GmailClient';

import {
  agentData,
  adminCredentials,
  systemCredentials,
  resetPassword,
} from '../../data/testData';

/**
 * Full DMoney Agent lifecycle, driven against the live portal:
 *
 *   register -> admin activates -> system tops up 2000 -> agent verifies
 *   balance -> agent deposits 500 to a customer -> password reset ->
 *   old password rejected -> new password works -> export Self Statement.
 */
test.describe('DMoney Agent lifecycle (regression)', () => {
  test('completes the full Agent journey end to end', async ({
    page,
    request,
  }) => {
    const gmail = new GmailClient(request);

    // --- 1. Register a new Agent -------------------------------------
    const signup = new SignupPage(page);
    await signup.goto();

    console.log('Registering agent:', agentData.email);
    await signup.fillRegistrationData(
      agentData.fullName,
      agentData.email,
      agentData.password,
      agentData.phone,
      agentData.nid
    );
    await signup.selectAgentRole();
    await signup.createAccount();

    await expect(
      page.getByText(
        'Registration successful. Your account is pending approval by an admin.'
      )
    ).toBeVisible();
    console.log('Agent registered (pending approval)');

    // --- 2. Admin logs in --------------------------------------------
    const adminLogin = new LoginPage(page);
    await adminLogin.goto();
    await adminLogin.login(
      adminCredentials.email,
      adminCredentials.password
    );
    console.log('Admin login successful');

    // --- 3. Find the Agent and confirm it is PENDING -----------------
    const admin = new AdminPage(page);
    await admin.openUsers();
    await admin.selectEmailSearch();
    await admin.searchByEmail(agentData.email);
    await admin.verifyAgentExists();
    await admin.verifyAgentPending();
    console.log('Agent located with PENDING status');

    // --- 4. Activate the Agent ---------------------------------------
    await admin.openAgentDetails();
    await admin.editUser();
    await admin.changeStatusToActive();
    await admin.saveChanges();
    await admin.verifyAgentActive();

    // Status must survive a reload.
    await page.reload();
    await admin.verifyAgentActive();
    console.log('Agent activated and still ACTIVE after reload');

    // --- 5. Collect existing Customers (needed before admin logout) --
    const customerAccounts = await admin.findExistingCustomerAccounts();
    expect(
      customerAccounts.length,
      'At least one existing Customer account should be available'
    ).toBeGreaterThan(0);

    await admin.logout();

    // --- 6. System logs in and tops up the Agent with 2000 Tk --------
    const systemLogin = new LoginPage(page);
    await systemLogin.goto();
    await systemLogin.login(
      systemCredentials.email,
      systemCredentials.password
    );
    await expect(page).toHaveURL(/.*\/profile/, { timeout: 10000 });
    await expect(
      page.getByRole('main').getByText('SYSTEM', { exact: true })
    ).toBeVisible();
    console.log('System login successful');

    const system = new SystemPage(page);
    await system.openCashIn();
    await system.cashIn(agentData.phone, '2000');
    console.log(`System deposited 2000 Tk to agent ${agentData.phone}`);
    await system.logout();

    // --- 7. Agent logs in (OTP) and confirms the 2000 Tk balance -----
    const agentLogin = new LoginPage(page);
    await agentLogin.goto();
    const agentOtpBaseline = await gmail.snapshotMessageIds(
      agentData.email
    );
    await agentLogin.login(agentData.email, agentData.password);

    const agentOtp = await gmail.waitForOtp(
      agentOtpBaseline,
      agentData.email
    );
    console.log('Agent OTP received:', agentOtp);
    await agentLogin.verifyOtp(agentOtp);
    console.log('Agent login successful');

    const agent = new AgentPage(page);
    await agent.verifyBalance('2000');

    // --- 8. Agent deposits 500 Tk to an existing Customer ------------
    await agent.openCashIn();
    const customer = await agent.cashInToAnyCustomer(
      customerAccounts,
      '500'
    );
    console.log('500 Tk deposited to customer:', customer);

    // The Agent earns a 12.50 Tk commission, so 2000 - 500 + 12.50.
    await page.goto('/profile');
    await expect(page).toHaveURL(/.*\/profile/, { timeout: 10000 });
    await agent.verifyBalance('1512.50');
    console.log('Agent balance after customer deposit: 1512.50 Tk');

    await agent.logout();

    // --- 9. Reset the Agent password ---------------------------------
    const resetEntry = new LoginPage(page);
    await resetEntry.goto();
    await resetEntry.openForgotPassword();

    const passwordReset = new PasswordResetPage(page);
    await passwordReset.reset(agentData.email, resetPassword, gmail);
    console.log('Agent password reset complete');

    // --- 10. Old password must be rejected ---------------------------
    const oldLogin = new LoginPage(page);
    await oldLogin.goto();
    await oldLogin.login(agentData.email, agentData.password);

    const rejection = page
      .getByText(
        /invalid credentials|invalid email|invalid phone|incorrect password|wrong password|password (?:is )?(?:incorrect|invalid|wrong|does not match)|login failed|account is deactivated/i
      )
      .first();
    await expect(
      rejection,
      'Old password should produce a login rejection'
    ).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/login(?:[?#].*)?$/, {
      timeout: 10000,
    });
    console.log('Old password correctly rejected');

    // --- 11. New password logs in (OTP) ------------------------------
    const newLogin = new LoginPage(page);
    await newLogin.goto();
    const newOtpBaseline = await gmail.snapshotMessageIds(
      agentData.email
    );
    await newLogin.login(agentData.email, resetPassword);

    const newOtp = await gmail.waitForOtp(newOtpBaseline, agentData.email);
    console.log('New-password login OTP:', newOtp);
    await newLogin.verifyOtp(newOtp);
    console.log('New password login successful');

    // --- 12. Open the Self Statement and extract every row -----------
    const agentAfterReset = new AgentPage(page);
    await agentAfterReset.openSelfStatement();

    const statementTable = page.locator('table');
    await expect(statementTable).toBeVisible({ timeout: 10000 });

    const headers = (
      await statementTable.locator('thead th').allInnerTexts()
    ).map((value) => value.trim());
    expect(
      headers.length,
      'Self Statement should expose table headers'
    ).toBeGreaterThan(0);

    const bodyRows = statementTable.locator('tbody tr');

    // The statement defaults to a one-day filter that can hide same-day
    // transactions. Widen it to a window around today so both the System
    // top-up and the Customer deposit are always listed.
    const pad = (n: number) => String(n).padStart(2, '0');
    const toISODate = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 3);
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 1);

    await agentAfterReset.setStatementDateRange(
      toISODate(fromDate),
      toISODate(toDate)
    );

    // Wait for the empty-state placeholder to disappear (i.e. real rows
    // loaded) before extracting.
    await expect(
      page.getByText(/No transactions found/i)
    ).toHaveCount(0, { timeout: 15000 });

    const extractedRows: string[][] = [];
    const seenRows = new Set<string>();

    // Gather rows across every page of the statement.
    while (true) {
      const rowCount = await bodyRows.count();

      for (let i = 0; i < rowCount; i++) {
        const cells = (
          await bodyRows.nth(i).locator('td').allInnerTexts()
        ).map((value) => value.trim());

        // Skip empty-state rows and anything with a mismatched shape.
        if (
          cells.length !== headers.length ||
          cells.join(' ').toLowerCase().includes('no transactions found')
        ) {
          continue;
        }

        const rowKey = cells.join('\u001f');
        if (!seenRows.has(rowKey)) {
          seenRows.add(rowKey);
          extractedRows.push(cells);
        }
      }

      const nextPage = page
        .getByRole('button', { name: /go to next page/i })
        .last();
      const hasNext = await nextPage.isVisible().catch(() => false);
      if (!hasNext || (await nextPage.isDisabled())) {
        break;
      }

      const firstRowBefore =
        rowCount > 0
          ? (await bodyRows.first().innerText()).trim()
          : '';
      await nextPage.click();

      if (firstRowBefore) {
        await expect
          .poll(async () => (await bodyRows.first().innerText()).trim())
          .not.toBe(firstRowBefore);
      } else {
        await expect(bodyRows.first()).toBeVisible();
      }
    }

    console.log('Self Statement headers:', headers);
    console.log('Self Statement rows extracted:', extractedRows.length);

    // --- 13. Verify the two expected transactions --------------------
    const customerTransaction = extractedRows.find(
      (row) =>
        row[1].replace(/\s/g, '') ===
          agentData.phone.replace(/\s/g, '') &&
        row[2].replace(/\s/g, '') === customer.replace(/\s/g, '') &&
        /deposit/i.test(row[3]) &&
        Number(row[4].replace(/,/g, '')) === 500
    );
    expect(
      customerTransaction,
      'Expected the 500 Tk customer transaction in Self Statement'
    ).toBeDefined();
    expect(
      Number(customerTransaction?.[6]?.replace(/,/g, '')),
      'Expected Agent balance 1512.50 after the customer deposit'
    ).toBe(1512.5);

    const systemTopUp = extractedRows.find(
      (row) =>
        row[1].trim().toUpperCase() === 'SYSTEM' &&
        row[2].replace(/\s/g, '') ===
          agentData.phone.replace(/\s/g, '') &&
        /top-up/i.test(row[3]) &&
        Number(row[5].replace(/,/g, '')) === 2000
    );
    expect(
      systemTopUp,
      'Expected the 2000 Tk System top-up in Self Statement'
    ).toBeDefined();

    expect(
      extractedRows.length,
      'Both required transactions should be present'
    ).toBeGreaterThanOrEqual(2);

    // --- 14. Save the statement to a dated CSV -----------------------
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');

    const csvEscape = (value: string): string =>
      `"${value.replace(/"/g, '""')}"`;

    const csvContent =
      [
        headers.map(csvEscape).join(','),
        ...extractedRows.map((row) => row.map(csvEscape).join(',')),
      ].join('\r\n') + '\r\n';

    const outputDir = path.resolve('reports');
    await mkdir(outputDir, { recursive: true });

    const csvPath = path.join(outputDir, `self_statement_${today}.csv`);
    await writeFile(csvPath, csvContent, 'utf8');
    console.log('CSV saved:', csvPath);

    // --- 15. Verify the saved CSV ------------------------------------
    expect(path.basename(csvPath)).toMatch(
      /^self_statement_\d{4}-\d{2}-\d{2}\.csv$/
    );

    const savedCsv = await readFile(csvPath, 'utf8');
    expect(
      savedCsv,
      'Saved CSV should match the extracted statement'
    ).toBe(csvContent);
    expect(savedCsv).toContain(csvEscape(agentData.phone));
    expect(savedCsv).toContain(csvEscape(customer));
    expect(
      savedCsv,
      'CSV should include the 2000 Tk System top-up'
    ).toContain(csvEscape('Top-up from SYSTEM'));
    expect(
      savedCsv,
      'CSV should include the 500 Tk customer deposit'
    ).toMatch(/deposit commission/i);

    console.log('Self Statement verified and CSV export confirmed');
    console.log('DMoney regression flow complete');
  });
});
