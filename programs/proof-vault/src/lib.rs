//! proof_vault — sealed envelopes and the collector desk for $PROOF (SPEC §7).
//!
//! Guarantees enforced here:
//! - Envelopes and their vaults are PDAs of this program: no private keys, no account extensions.
//! - Only the $PROOF mint is accepted.
//! - The only instruction that moves tokens out of a vault is `withdraw` (which melts, per the
//!   indexer rules). Sales and gifts change the holder record; the tokens never move.
//!
//! This program cannot see token positions. Which ranges an envelope really holds is decided by
//! the indexer; `ranges` here is the seller's declaration, checked only for shape and total.
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked};

// Placeholder ids. Replace both before deploying (SPEC §11).
declare_id!("7wGSg7XW8KGGHF772PUoNnGKAKWSCFuRu3tdsLXEY62D");
pub const PROOF_MINT: Pubkey = pubkey!("3kUPFSPaWRhnJZGceW2bWVgaR8m93NdtuHzyATrXD4j5");

pub const MAX_RANGES: usize = 8;

#[program]
pub mod proof_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.next_id = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn seal(ctx: Context<Seal>, ranges: Vec<RangeArg>) -> Result<()> {
        let total = validate_ranges(&ranges)?;
        let envelope_bump = ctx.bumps.envelope;
        let a = &mut *ctx.accounts;

        token_interface::transfer_checked(
            CpiContext::new(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.source.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.vault.to_account_info(),
                    authority: a.holder.to_account_info(),
                },
            ),
            total,
            a.mint.decimals,
        )?;
        // Rejects mints that deliver less than was sent (e.g. transfer fees).
        a.vault.reload()?;
        require!(a.vault.amount == total, VaultError::AmountMismatch);

        let env = &mut a.envelope;
        env.id = a.config.next_id;
        env.holder = a.holder.key();
        env.vault = a.vault.key();
        env.amount = total;
        env.status = Status::Sealed;
        env.price = 0;
        env.ranges = ranges;
        env.sealed_slot = Clock::get()?.slot;
        env.bump = envelope_bump;
        a.config.next_id = a.config.next_id.checked_add(1).ok_or(VaultError::Overflow)?;

        emit!(Sealed { envelope: env.key(), id: env.id, holder: env.holder, amount: total });
        Ok(())
    }

    pub fn list(ctx: Context<HolderOnly>, price: u64) -> Result<()> {
        let env = &mut ctx.accounts.envelope;
        require!(env.status == Status::Sealed, VaultError::WrongStatus);
        require!(price > 0, VaultError::ZeroPrice);
        env.status = Status::Listed;
        env.price = price;
        emit!(Listed { envelope: env.key(), price });
        Ok(())
    }

    pub fn cancel(ctx: Context<HolderOnly>) -> Result<()> {
        let env = &mut ctx.accounts.envelope;
        require!(env.status == Status::Listed, VaultError::WrongStatus);
        env.status = Status::Sealed;
        env.price = 0;
        emit!(Cancelled { envelope: env.key() });
        Ok(())
    }

    /// Pays the holder and transfers the holder record in one transaction.
    /// `max_price` protects the buyer if the listing changes before this lands.
    pub fn buy(ctx: Context<Buy>, max_price: u64) -> Result<()> {
        let a = &mut *ctx.accounts;
        require!(a.envelope.status == Status::Listed, VaultError::WrongStatus);
        require_keys_eq!(a.holder.key(), a.envelope.holder, VaultError::WrongHolder);
        require_keys_neq!(a.buyer.key(), a.envelope.holder, VaultError::SelfPurchase);
        let price = a.envelope.price;
        require!(price <= max_price, VaultError::PriceChanged);

        system_program::transfer(
            CpiContext::new(
                a.system_program.to_account_info(),
                system_program::Transfer { from: a.buyer.to_account_info(), to: a.holder.to_account_info() },
            ),
            price,
        )?;

        let env = &mut a.envelope;
        let seller = env.holder;
        env.holder = a.buyer.key();
        env.status = Status::Sealed;
        env.price = 0;
        emit!(Sold { envelope: env.key(), seller, buyer: env.holder, price });
        Ok(())
    }

    pub fn gift(ctx: Context<HolderOnly>, new_holder: Pubkey) -> Result<()> {
        let env = &mut ctx.accounts.envelope;
        require!(env.status == Status::Sealed, VaultError::WrongStatus);
        require!(new_holder != Pubkey::default(), VaultError::WrongHolder);
        let from = env.holder;
        env.holder = new_holder;
        emit!(Gifted { envelope: env.key(), from, to: new_holder });
        Ok(())
    }

    /// Sends everything in the vault to `destination` and closes the envelope. Irreversible:
    /// under the $PROOF rules the tokens melt into ordinary $PROOF.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let a = &mut *ctx.accounts;
        require!(a.envelope.status == Status::Sealed, VaultError::WrongStatus);

        let id = a.envelope.id.to_le_bytes();
        let bump = [a.envelope.bump];
        let seeds: &[&[u8]] = &[b"envelope", &id, &bump];
        let signer = &[seeds];
        let amount = a.vault.amount;

        if amount > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    a.token_program.to_account_info(),
                    TransferChecked {
                        from: a.vault.to_account_info(),
                        mint: a.mint.to_account_info(),
                        to: a.destination.to_account_info(),
                        authority: a.envelope.to_account_info(),
                    },
                    signer,
                ),
                amount,
                a.mint.decimals,
            )?;
        }
        token_interface::close_account(CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            CloseAccount {
                account: a.vault.to_account_info(),
                destination: a.holder.to_account_info(),
                authority: a.envelope.to_account_info(),
            },
            signer,
        ))?;

        emit!(Withdrawn { envelope: a.envelope.key(), holder: a.holder.key(), amount });
        Ok(())
    }
}

pub fn validate_ranges(ranges: &[RangeArg]) -> Result<u64> {
    require!(!ranges.is_empty() && ranges.len() <= MAX_RANGES, VaultError::BadRangeCount);
    let mut total: u64 = 0;
    let mut prev_end: Option<u64> = None;
    for r in ranges {
        require!(r.len > 0, VaultError::EmptyRange);
        let end = r.start.checked_add(r.len).ok_or(VaultError::Overflow)?;
        if let Some(p) = prev_end {
            require!(r.start >= p, VaultError::UnsortedRanges);
        }
        prev_end = Some(end);
        total = total.checked_add(r.len).ok_or(VaultError::Overflow)?;
    }
    Ok(total)
}

// ---- accounts ----

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

// Account order is part of the spec (SPEC §7): the indexer decodes by position.
#[derive(Accounts)]
pub struct Seal<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = holder,
        space = 8 + Envelope::INIT_SPACE,
        seeds = [b"envelope", config.next_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub envelope: Account<'info, Envelope>,
    #[account(
        init,
        payer = holder,
        seeds = [b"vault", envelope.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = envelope,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = holder, token::token_program = token_program)]
    pub source: InterfaceAccount<'info, TokenAccount>,
    #[account(address = PROOF_MINT @ VaultError::WrongMint, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct HolderOnly<'info> {
    pub holder: Signer<'info>,
    #[account(mut, has_one = holder @ VaultError::WrongHolder)]
    pub envelope: Account<'info, Envelope>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: checked against `envelope.holder` in the handler; only receives lamports.
    #[account(mut)]
    pub holder: UncheckedAccount<'info>,
    #[account(mut)]
    pub envelope: Account<'info, Envelope>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(
        mut,
        has_one = holder @ VaultError::WrongHolder,
        has_one = vault @ VaultError::WrongVault,
        close = holder,
    )]
    pub envelope: Account<'info, Envelope>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    #[account(address = PROOF_MINT @ VaultError::WrongMint, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

// ---- state ----

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub next_id: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Envelope {
    pub id: u64,
    pub holder: Pubkey,
    pub vault: Pubkey,
    pub amount: u64,
    pub status: Status,
    pub price: u64,
    #[max_len(8)]
    pub ranges: Vec<RangeArg>,
    pub sealed_slot: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Status {
    Sealed,
    Listed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub struct RangeArg {
    pub start: u64,
    pub len: u64,
}

// ---- events ----

#[event]
pub struct Sealed { pub envelope: Pubkey, pub id: u64, pub holder: Pubkey, pub amount: u64 }
#[event]
pub struct Listed { pub envelope: Pubkey, pub price: u64 }
#[event]
pub struct Cancelled { pub envelope: Pubkey }
#[event]
pub struct Sold { pub envelope: Pubkey, pub seller: Pubkey, pub buyer: Pubkey, pub price: u64 }
#[event]
pub struct Gifted { pub envelope: Pubkey, pub from: Pubkey, pub to: Pubkey }
#[event]
pub struct Withdrawn { pub envelope: Pubkey, pub holder: Pubkey, pub amount: u64 }

#[error_code]
pub enum VaultError {
    #[msg("Mint is not $PROOF")]
    WrongMint,
    #[msg("Signer is not the envelope holder")]
    WrongHolder,
    #[msg("Vault does not belong to this envelope")]
    WrongVault,
    #[msg("Envelope is in the wrong state for this action")]
    WrongStatus,
    #[msg("Price must be greater than zero")]
    ZeroPrice,
    #[msg("Listing price is above the buyer's maximum")]
    PriceChanged,
    #[msg("Holder cannot buy their own envelope")]
    SelfPurchase,
    #[msg("Between 1 and 8 ranges are required")]
    BadRangeCount,
    #[msg("Ranges must be non-empty")]
    EmptyRange,
    #[msg("Ranges must be sorted and non-overlapping")]
    UnsortedRanges,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Vault received a different amount than was sent")]
    AmountMismatch,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(start: u64, len: u64) -> RangeArg {
        RangeArg { start, len }
    }

    #[test]
    fn ranges_validation() {
        assert_eq!(validate_ranges(&[r(0, 5), r(5, 3)]).unwrap(), 8);
        assert!(validate_ranges(&[]).is_err());
        assert!(validate_ranges(&[r(0, 0)]).is_err());
        assert!(validate_ranges(&[r(10, 5), r(0, 5)]).is_err());
        assert!(validate_ranges(&[r(0, 5), r(4, 5)]).is_err());
        assert!(validate_ranges(&[r(u64::MAX, 1)]).is_err());
        assert!(validate_ranges(&vec![r(0, 1); 9]).is_err());
    }
}
