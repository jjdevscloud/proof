//! DEVNET ONLY. A stand-in for the pump.fun bonding curve so the indexer can be tested end to end.
//! It moves tokens the way pump.fun does (buy: curve -> buyer, sell: seller -> curve) and uses the
//! same Anchor instruction name `buy`, so the indexer only needs this program's id in its config.
//! There is no pricing: tokens are free.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("4vocGpRYJaXoDKP5KDeUv566kgAzsKSDkvCqj2pVL7M4");

#[program]
pub mod mock_curve {
    use super::*;

    pub fn initialize_curve(ctx: Context<InitializeCurve>) -> Result<()> {
        ctx.accounts.curve.mint = ctx.accounts.mint.key();
        ctx.accounts.curve.bump = ctx.bumps.curve;
        Ok(())
    }

    pub fn buy(ctx: Context<Buy>, amount: u64, _max_sol_cost: u64) -> Result<()> {
        let a = &ctx.accounts;
        let mint_key = a.mint.key();
        let seeds: &[&[u8]] = &[b"curve", mint_key.as_ref(), &[a.curve.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.curve_tokens.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.destination.to_account_info(),
                    authority: a.curve.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            a.mint.decimals,
        )
    }

    pub fn sell(ctx: Context<Sell>, amount: u64, _min_sol_output: u64) -> Result<()> {
        let a = &ctx.accounts;
        token_interface::transfer_checked(
            CpiContext::new(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.source.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.curve_tokens.to_account_info(),
                    authority: a.seller.to_account_info(),
                },
            ),
            amount,
            a.mint.decimals,
        )
    }

    /// Same token movement as `buy` under a different instruction name: the indexer must treat
    /// it as a plain (common) transfer, like pump.fun's migration to the AMM.
    pub fn migrate(ctx: Context<Buy>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        let mint_key = a.mint.key();
        let seeds: &[&[u8]] = &[b"curve", mint_key.as_ref(), &[a.curve.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.curve_tokens.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.destination.to_account_info(),
                    authority: a.curve.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            a.mint.decimals,
        )
    }
}

#[derive(Accounts)]
pub struct InitializeCurve<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = payer, space = 8 + Curve::INIT_SPACE, seeds = [b"curve", mint.key().as_ref()], bump)]
    pub curve: Account<'info, Curve>,
    #[account(
        init,
        payer = payer,
        seeds = [b"curve_tokens", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = curve,
        token::token_program = token_program,
    )]
    pub curve_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    pub buyer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [b"curve", mint.key().as_ref()], bump = curve.bump, has_one = mint)]
    pub curve: Account<'info, Curve>,
    #[account(mut, seeds = [b"curve_tokens", mint.key().as_ref()], bump)]
    pub curve_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    pub seller: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [b"curve", mint.key().as_ref()], bump = curve.bump, has_one = mint)]
    pub curve: Account<'info, Curve>,
    #[account(mut, seeds = [b"curve_tokens", mint.key().as_ref()], bump)]
    pub curve_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = seller)]
    pub source: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Curve {
    pub mint: Pubkey,
    pub bump: u8,
}
